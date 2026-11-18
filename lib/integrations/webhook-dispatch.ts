import { request as httpsRequest, Agent } from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import {
  decryptWebhookSecret,
  type WebhookEncryption,
} from './webhook-encryption.ts';
import {
  resolveWebhookDestination,
  webhookUrl,
  WebhookDestinationError,
} from './webhook-destination.ts';
import { webhookSignature } from './webhook-signature.ts';
export type WebhookJob = {
  id: string;
  endpointId: string;
  integrationId: string;
  environment: 'test' | 'live';
  url: string;
  encryptedSecret: string;
  revision: number;
  leaseId: string;
  eventId: string;
  body: string;
  attempt: number;
};
export type WebhookResult = {
  http: number | null;
  outcome:
    | 'success'
    | 'http_retry'
    | 'http_permanent'
    | 'timeout'
    | 'network_error'
    | 'destination_blocked'
    | 'configuration_error';
  retryAfter?: number;
};
export function schedulerAuthorized(
  header: string | null,
  secret: string | undefined,
) {
  if (!secret || secret.length < 43 || secret.length > 256 || !header)
    return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function webhookRetryDelay(
  attempt: number,
  retryAfter = 0,
  jitter = Math.random(),
) {
  return Math.min(
    86400,
    Math.max(
      retryAfter,
      Math.round(30 * 2 ** Math.min(11, attempt - 1) * (1 + jitter * 0.2)),
    ),
  );
}
export function webhookHttpResult(
  status: number,
  retryAfter: string | undefined,
  now = Date.now(),
): WebhookResult {
  const seconds = retryAfter
    ? /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : Math.ceil((Date.parse(retryAfter) - now) / 1000)
    : 0;
  return {
    http: status,
    outcome:
      status >= 200 && status < 300
        ? 'success'
        : [408, 425, 429].includes(status) || status >= 500
          ? 'http_retry'
          : 'http_permanent',
    retryAfter: Number.isFinite(seconds)
      ? Math.max(0, Math.min(86400, seconds))
      : 0,
  };
}
export async function sendWebhook(
  job: WebhookJob,
  secret: string,
): Promise<WebhookResult> {
  try {
    const url = webhookUrl(job.url);
    const pinned = await resolveWebhookDestination(url);
    const timestamp = Math.floor(Date.now() / 1000);
    // Disable connection pooling/proxies. The socket uses the already checked IP;
    // TLS certificate validation and SNI still use the original hostname.
    const agent = new Agent({ keepAlive: false, maxSockets: 1 });
    try {
      return await new Promise<WebhookResult>((resolve) => {
        let settled = false;
        const finish = (result: WebhookResult) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        };
        const req = httpsRequest(
          url,
          {
            method: 'POST',
            agent,
            servername: url.hostname,
            rejectUnauthorized: true,
            family: pinned.family,
            lookup: (_hostname, _options, callback) =>
              callback(null, pinned.address, pinned.family),
            maxHeaderSize: 8192,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(job.body),
              'User-Agent': 'NaijaTickets-Webhooks/1',
              'Naija-Webhook-Id': job.eventId,
              'Naija-Webhook-Timestamp': String(timestamp),
              'Naija-Webhook-Signature': `v1=${webhookSignature(secret, job.eventId, timestamp, job.body)}`,
            },
          },
          (response) => {
            // Only status/Retry-After is consumed; never persist untrusted response
            // bodies, headers, URLs or exception messages. Redirects are not followed.
            finish(
              webhookHttpResult(
                response.statusCode || 500,
                typeof response.headers['retry-after'] === 'string'
                  ? response.headers['retry-after']
                  : undefined,
              ),
            );
            response.destroy();
          },
        );
        const timer = setTimeout(() => {
          finish({ http: null, outcome: 'timeout' });
          req.destroy();
        }, 5000);
        req.on('error', () => finish({ http: null, outcome: 'network_error' }));
        req.end(job.body);
      });
    } finally {
      agent.destroy();
    }
  } catch (error) {
    return {
      http: null,
      outcome:
        error instanceof WebhookDestinationError ||
        (error instanceof Error && error.name === 'IntegrationError')
          ? 'destination_blocked'
          : 'network_error',
    };
  }
}
export type DispatchDependencies = {
  claim: () => Promise<WebhookJob[]>;
  authorize: (job: WebhookJob) => Promise<boolean>;
  finish: (
    job: WebhookJob,
    result: WebhookResult,
    delay: number,
  ) => Promise<unknown>;
  send?: typeof sendWebhook;
  now?: () => number;
};
export async function dispatchWebhooks(
  deps: DispatchDependencies,
  config: WebhookEncryption,
) {
  const now = deps.now || Date.now,
    deadline = now() + 17000;
  let attempted = 0,
    succeeded = 0;
  for (let batch = 0; batch < 4 && now() < deadline; batch++) {
    const jobs = await deps.claim();
    if (!jobs.length) break;
    const outcomes = await Promise.allSettled(
      jobs.map(async (job) => {
        // An error leaves the lease durable. A later worker recovers it.
        let secret: string;
        try {
          secret = decryptWebhookSecret(
            job.encryptedSecret,
            `${job.endpointId}:${job.integrationId}:${job.environment}`,
            config,
          );
        } catch {
          await deps.finish(
            job,
            { http: null, outcome: 'configuration_error' },
            86400,
          );
          return;
        }
        if (!(await deps.authorize(job))) return;
        const result = await (deps.send || sendWebhook)(job, secret);
        await deps.finish(
          job,
          result,
          webhookRetryDelay(job.attempt, result.retryAfter),
        );
        attempted++;
        if (result.outcome === 'success') succeeded++;
      }),
    );
    if (outcomes.some((outcome) => outcome.status === 'rejected'))
      throw new Error(
        'Webhook batch could not be completed. Durable leases remain recoverable.',
      );
  }
  return { attempted, succeeded };
}
