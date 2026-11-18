import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  webhookSignature,
  verifyWebhookSignature,
} from './integrations/webhook-signature.ts';
import {
  webhookEncryption,
  encryptWebhookSecret,
  decryptWebhookSecret,
  newWebhookSecret,
} from './integrations/webhook-encryption.ts';
import {
  webhookUrl,
  publicWebhookAddress,
  resolveWebhookDestination,
} from './integrations/webhook-destination.ts';
import {
  schedulerAuthorized,
  webhookHttpResult,
  webhookRetryDelay,
  dispatchWebhooks,
  type WebhookJob,
} from './integrations/webhook-dispatch.ts';

void test('webhook signatures bind exact raw JSON, immutable ID and fresh timestamp', () => {
  const secret = newWebhookSecret(),
    body = '{"amount":500}',
    id = crypto.randomUUID();
  const stamp = Math.floor(Date.now() / 1000),
    sig = webhookSignature(secret, id, stamp, body);
  assert.ok(verifyWebhookSignature(secret, id, String(stamp), body, sig));
  for (const [event, raw, timestamp, key] of [
    [id, body + ' ', stamp, secret],
    [crypto.randomUUID(), body, stamp, secret],
    [id, body, stamp - 301, secret],
    [id, body, stamp + 301, secret],
    [id, body, stamp, newWebhookSecret()],
  ] as const)
    assert.equal(
      verifyWebhookSignature(key, event, String(timestamp), raw, sig),
      false,
    );
  assert.equal(
    verifyWebhookSignature(secret, id, String(stamp), body, 'bad'),
    false,
  );
});
void test('AES-GCM encryption is context-bound, authenticated and supports bounded key rotation', () => {
  const v1 = randomBytes(32).toString('base64url'),
    v2 = randomBytes(32).toString('base64url');
  const config = webhookEncryption({
    INTEGRATIONS_WEBHOOK_ENCRYPTION_KEYS: JSON.stringify({ v1 }),
  });
  const secret = newWebhookSecret(),
    context = 'endpoint:app:test';
  const encrypted = encryptWebhookSecret(secret, context, config);
  assert.ok(!encrypted.includes(secret));
  const rotated = { active: 'v2', keys: { v1, v2 } };
  assert.equal(decryptWebhookSecret(encrypted, context, rotated), secret);
  assert.throws(() =>
    decryptWebhookSecret(encrypted, 'endpoint:other:live', config),
  );
  assert.throws(() =>
    decryptWebhookSecret(encrypted.replace(/.$/, '#'), context, config),
  );
  assert.throws(() =>
    decryptWebhookSecret(encrypted, context, { active: 'v2', keys: { v2 } }),
  );
  assert.throws(() =>
    webhookEncryption({
      INTEGRATIONS_WEBHOOK_ENCRYPTION_KEYS: JSON.stringify({ v1 }),
      CRON_SECRET: v1,
    }),
  );
  assert.throws(() =>
    webhookEncryption({ INTEGRATIONS_WEBHOOK_ENCRYPTION_KEYS: '{}' }),
  );
});
void test('webhook destinations reject URL tricks, credentials, ports, private IPs and IPv6 transition addresses', async () => {
  for (const url of [
    'http://partner.com/hooks',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://user:secret@partner.com/',
    'https://partner.com:8443/',
    'https://partner.com/?secret=x',
    'https://partner.com/#x',
    'https://localhost/',
    'https://metadata.internal/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://partner.com\\@127.0.0.1/',
  ])
    assert.throws(() => webhookUrl(url));
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.2.1',
    '192.168.2.1',
    '192.0.0.1',
    '192.0.2.10',
    '198.18.1.1',
    '198.51.100.2',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:808:808::1',
    '2001::1',
    '3fff::1',
  ])
    assert.equal(publicWebhookAddress(address), false, address);
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])
    assert.equal(publicWebhookAddress(address), true);
  const url = webhookUrl('https://partner.com/hooks');
  const good = { address: '1.1.1.1', family: 4 };
  assert.deepEqual(
    await resolveWebhookDestination(url, async () => [good]),
    good,
  );
  await assert.rejects(() =>
    resolveWebhookDestination(url, async () => [
      good,
      { address: '127.0.0.1', family: 4 },
    ]),
  );
  await assert.rejects(() => resolveWebhookDestination(url, async () => []));
  await assert.rejects(() =>
    resolveWebhookDestination(url, async () => [
      { address: '1.1.1.1', family: 6 },
    ]),
  );
  // A fresh lookup on every send prevents a cached pre-validation from authorising rebinding.
  let calls = 0;
  const rebind = async () =>
    ++calls === 1 ? [good] : [{ address: '169.254.169.254', family: 4 }];
  await resolveWebhookDestination(url, rebind);
  await assert.rejects(() => resolveWebhookDestination(url, rebind));
});
void test('scheduler fails closed and retry classification handles redirects, rate limits and permanent errors', () => {
  const secret = 's'.repeat(43);
  assert.ok(schedulerAuthorized(`Bearer ${secret}`, secret));
  for (const header of [null, secret, `Bearer ${secret}x`, 'Bearer wrong'])
    assert.equal(schedulerAuthorized(header, secret), false);
  assert.equal(schedulerAuthorized('Bearer ', ''), false);
  assert.equal(webhookHttpResult(204, undefined).outcome, 'success');
  for (const code of [408, 425, 429, 500, 503])
    assert.equal(webhookHttpResult(code, '120').outcome, 'http_retry');
  for (const code of [301, 302, 307, 400, 401, 403, 404, 410])
    assert.equal(webhookHttpResult(code, undefined).outcome, 'http_permanent');
  assert.equal(webhookRetryDelay(1, 0, 0), 30);
  assert.equal(webhookRetryDelay(8, 864000, 0), 86400);
  assert.equal(
    webhookHttpResult(429, new Date(200000).toUTCString(), 100000).retryAfter,
    100,
  );
});
void test('dispatcher bounds batches, signs current secret and does not send revoked or undecryptable jobs', async () => {
  const secret = newWebhookSecret(),
    config = {
      active: 'v1',
      keys: { v1: randomBytes(32).toString('base64url') },
    };
  const job: WebhookJob = {
    id: crypto.randomUUID(),
    endpointId: 'endpoint',
    integrationId: 'app',
    environment: 'test',
    url: 'https://partner.com/hooks',
    revision: 1,
    leaseId: crypto.randomUUID(),
    encryptedSecret: encryptWebhookSecret(secret, 'endpoint:app:test', config),
    eventId: crypto.randomUUID(),
    body: '{}',
    attempt: 1,
  };
  let claimed = 0,
    sent = 0,
    finished = 0;
  const result = await dispatchWebhooks(
    {
      claim: async () => {
        claimed++;
        return [job];
      },
      authorize: async () => true,
      send: async (_job, actual) => {
        assert.equal(actual, secret);
        sent++;
        return { http: 200, outcome: 'success' };
      },
      finish: async () => {
        finished++;
      },
    },
    config,
  );
  assert.deepEqual(result, { attempted: 4, succeeded: 4 });
  assert.equal(claimed, 4);
  assert.equal(sent, 4);
  assert.equal(finished, 4);
  await dispatchWebhooks(
    {
      claim: async () => [job],
      authorize: async () => false,
      send: async () => {
        throw new Error('must not send revoked job');
      },
      finish: async () => {
        throw new Error('must not finish revoked job');
      },
    },
    config,
  );
  await dispatchWebhooks(
    {
      claim: async () => [{ ...job, encryptedSecret: 'invalid' }],
      authorize: async () => true,
      send: async () => {
        throw new Error('must not send undecryptable job');
      },
      finish: async (_job, result) => {
        assert.equal(result.outcome, 'configuration_error');
      },
    },
    config,
  );
});
