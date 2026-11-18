import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWebhookInbox,
  partnerWebhookReceiver,
} from './integrations/webhook-receiver.ts';
import { webhookSignature } from './integrations/webhook-signature.ts';
import { newWebhookSecret } from './integrations/webhook-encryption.ts';
void test('reference partner receiver persists verified events and deduplicates across restart, rejecting replay and identity changes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'naija-webhook-inbox-'));
  const config = {
    integrationId: crypto.randomUUID(),
    environment: 'test' as const,
    secret: newWebhookSecret(),
  };
  const event = {
    id: crypto.randomUUID(),
    integration_id: config.integrationId,
    environment: 'test',
    type: 'order.paid',
    api_version: '2026-10-16',
    data: { order_id: crypto.randomUUID() },
  };
  let db = createWebhookInbox(join(folder, 'inbox.sqlite'));
  try {
    const req = (
      body = JSON.stringify(event),
      stamp = Math.floor(Date.now() / 1000),
      secret = config.secret,
    ) =>
      new Request('https://partner.com/hooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Naija-Webhook-Id': event.id,
          'Naija-Webhook-Timestamp': String(stamp),
          'Naija-Webhook-Signature': `v1=${webhookSignature(secret, event.id, stamp, body)}`,
        },
        body,
      });
    let receive = partnerWebhookReceiver(db, config);
    assert.equal((await receive(req())).status, 200);
    assert.equal((await receive(req())).status, 200);
    db.close();
    db = createWebhookInbox(join(folder, 'inbox.sqlite'));
    receive = partnerWebhookReceiver(db, config);
    assert.equal((await receive(req())).status, 200);
    assert.equal(
      db.prepare('select count(*) n from webhook_inbox').get()!.n,
      1,
    );
    assert.equal(
      (
        await receive(
          req(JSON.stringify(event), Math.floor(Date.now() / 1000) - 301),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await receive(
          req(
            JSON.stringify(event),
            Math.floor(Date.now() / 1000),
            newWebhookSecret(),
          ),
        )
      ).status,
      401,
    );
    assert.equal(
      (await receive(req(JSON.stringify({ ...event, environment: 'live' }))))
        .status,
      400,
    );
    assert.equal(
      (
        await receive(
          req(
            JSON.stringify({ ...event, integration_id: crypto.randomUUID() }),
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (await receive(req(JSON.stringify({ ...event, type: 'ticket.issued' }))))
        .status,
      409,
    );
    assert.equal((await receive(req('x'.repeat(16385)))).status, 413);
    db.close();
    assert.equal((await receive(req())).status, 503);
    db = createWebhookInbox(join(folder, 'inbox.sqlite'));
  } finally {
    db.close();
    await rm(folder, { recursive: true, force: true });
  }
});
