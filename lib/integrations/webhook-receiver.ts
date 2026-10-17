// Reference receiver for a persistent Node server. Vercel receivers must use a
// durable database, never a local SQLite file on the function filesystem.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { verifyWebhookSignature } from './webhook-signature.ts';
import { WEBHOOK_EVENTS } from './webhook-types.ts';
import { INTEGRATION_ID_PATTERN } from './validation.ts';
export function createWebhookInbox(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`pragma journal_mode=WAL; pragma synchronous=FULL;
    create table if not exists webhook_inbox (
      id text primary key, integration_id text not null, environment text not null,
      type text not null, payload_hash text not null, body text not null,
      received_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );`);
  return db;
}
export function partnerWebhookReceiver(
  db: DatabaseSync,
  configuration: {
    integrationId: string;
    environment: 'test' | 'live';
    secret: string;
  },
) {
  if (
    !INTEGRATION_ID_PATTERN.test(configuration.integrationId) ||
    !['test', 'live'].includes(configuration.environment) ||
    !/^whsec_[A-Za-z0-9_-]{43}$/.test(configuration.secret)
  )
    throw new Error(
      'Configure a dedicated webhook identity and signing secret.',
    );
  return async (request: Request) => {
    const respond = (status: number, message: string) =>
      Response.json(
        { message },
        {
          status,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    if (request.method !== 'POST') return respond(405, 'POST required.');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return respond(415, 'JSON required.');
    const id = request.headers.get('naija-webhook-id') || '';
    const timestamp = request.headers.get('naija-webhook-timestamp') || '';
    const signature = request.headers.get('naija-webhook-signature') || '';
    if (
      !INTEGRATION_ID_PATTERN.test(id) ||
      !/^v1=[a-f0-9]{64}$/.test(signature)
    )
      return respond(401, 'Invalid signature.');
    const reader = request.body?.getReader();
    if (!reader) return respond(400, 'Body required.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: string;
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 3000);
      });
      for (;;) {
        const { value, done } = await Promise.race([reader.read(), deadline]);
        if (done) break;
        size += value.byteLength;
        if (size > 16384) return respond(413, 'Body too large.');
        chunks.push(value);
      }
      raw = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch {
      return respond(400, 'Invalid body.');
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {});
    }
    if (
      !verifyWebhookSignature(
        configuration.secret,
        id,
        timestamp,
        raw,
        signature.slice(3),
      )
    )
      return respond(401, 'Invalid signature.');
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return respond(400, 'Invalid JSON.');
    }
    if (
      !event ||
      typeof event !== 'object' ||
      event.id !== id ||
      event.integration_id !== configuration.integrationId ||
      event.environment !== configuration.environment ||
      event.api_version !== '2026-10-16' ||
      !WEBHOOK_EVENTS.includes(event.type as (typeof WEBHOOK_EVENTS)[number])
    )
      return respond(400, 'Invalid event identity.');
    const hash = createHash('sha256').update(raw).digest('hex');
    try {
      // The event is acknowledged only after durable insertion. A separate
      // application worker can consume this inbox in its own DB transaction.
      const result = db
        .prepare(
          'insert into webhook_inbox(id,integration_id,environment,type,payload_hash,body) values(?,?,?,?,?,?) on conflict(id) do nothing',
        )
        .run(
          id,
          configuration.integrationId,
          configuration.environment,
          String(event.type),
          hash,
          raw,
        );
      const stored = db
        .prepare('select payload_hash from webhook_inbox where id=?')
        .get(id);
      if (stored?.payload_hash !== hash)
        return respond(409, 'Event ID payload conflict.');
      return respond(200, result.changes ? 'Accepted.' : 'Already accepted.');
    } catch {
      return respond(503, 'Inbox unavailable. Retry delivery.');
    }
  };
}
