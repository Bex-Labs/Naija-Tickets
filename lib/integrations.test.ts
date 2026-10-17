import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateIntegrationCredential,
  credentialDigest,
  parseIntegrationCredential,
} from './integrations/keys.ts';
import {
  canonicalIntegrationOrigin,
  parseIntegrationApplication,
  parseIntegrationKey,
  readIntegrationJson,
} from './integrations/validation.ts';
import {
  integrationApiHandler,
  integrationIntrospection,
  type IntegrationApiDependencies,
} from './integrations/api.ts';
import { IntegrationError } from './integrations/errors.ts';
import type { IntegrationContext } from './integrations/types.ts';
const owner = '10000000-0000-4000-8000-000000000001';
const app = '20000000-0000-4000-8000-000000000001';
const key = '30000000-0000-4000-8000-000000000001';
const context: IntegrationContext = {
  keyId: key,
  integrationId: app,
  organiserId: owner,
  environment: 'test',
  scopes: ['integration:read'],
  name: 'Event website',
  expiresAt: '2030-01-01T00:00:00Z',
};
void test('credentials have unique 256-bit secrets, strict mode parsing and only safe stored metadata', async () => {
  const credentials = await Promise.all(
    Array.from({ length: 64 }, () => generateIntegrationCredential('test')),
  );
  assert.equal(new Set(credentials.map((item) => item.credential)).size, 64);
  for (const generated of credentials) {
    assert.deepEqual(parseIntegrationCredential(generated.credential), {
      id: generated.id,
      environment: 'test',
    });
    assert.match(generated.digest, /^[a-f0-9]{64}$/);
    assert.equal(
      generated.digest,
      await credentialDigest(generated.credential),
    );
    assert.notEqual(generated.digest, generated.credential);
    assert.equal(generated.suffix.length, 4);
    assert.ok(
      !generated.prefix.includes(
        generated.credential.slice(
          `nt_test_${generated.id.replaceAll('-', '')}_`.length,
        ),
      ),
    );
  }
  const live = await generateIntegrationCredential('live');
  assert.equal(
    parseIntegrationCredential(live.credential)?.environment,
    'live',
  );
  for (const invalid of [
    'nt_widget_abc',
    live.credential + ' ',
    live.credential.slice(0, -1),
    'nt_live_x_y',
    'Bearer ' + live.credential,
  ])
    assert.equal(parseIntegrationCredential(invalid), null);
});
void test('integration configuration normalises exact origins and rejects unsafe/live-local origins', () => {
  assert.equal(
    canonicalIntegrationOrigin('https://EXAMPLE.com:443/', 'live'),
    'https://example.com',
  );
  assert.equal(
    canonicalIntegrationOrigin('http://localhost:3001', 'test'),
    'http://localhost:3001',
  );
  for (const value of [
    'https://example.com/a',
    '//example.com',
    'https://*.example.com',
    'https://user:pass@example.com',
    'https://example.com?x=1',
    'https://example.com/#secret',
    'http://example.com',
    'https://localhost',
    'https://example.com\\@evil.com',
  ])
    assert.throws(
      () => canonicalIntegrationOrigin(value, 'live'),
      IntegrationError,
    );
  assert.throws(
    () => parseIntegrationApplication({ organiserId: owner, name: 'A' }),
    /2 to 100/,
  );
  const result = parseIntegrationApplication({
    organiserId: owner,
    name: 'Website',
    domains: [
      { origin: 'https://example.com', environment: 'live' },
      { origin: 'https://example.com/', environment: 'live' },
    ],
    eventIds: [],
  });
  assert.equal(result.domains.length, 1);
  assert.deepEqual(result.eventIds, []);
});
void test('only implemented read scopes are grantable and expiry is bounded', () => {
  assert.deepEqual(
    parseIntegrationKey({ environment: 'live', scopes: [], expiresInDays: 30 })
      .scopes,
    [],
  );
  for (const body of [
    { environment: 'live', scopes: ['refunds:write'] },
    { environment: 'live', scopes: ['events:read', 'events:read'] },
    { environment: 'test', expiresInDays: 0 },
    { environment: 'test', expiresInDays: 366 },
    { environment: 'production' },
  ])
    assert.throws(() => parseIntegrationKey(body), IntegrationError);
});
void test('JSON request parsing enforces streamed byte limit, content type and malformed input', async () => {
  const create = (body: string, type = 'application/json') =>
    new Request('https://tickets.test/api', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    });
  assert.deepEqual(await readIntegrationJson(create('{"name":"Website"}')), {
    name: 'Website',
  });
  await assert.rejects(
    () => readIntegrationJson(create('{')),
    (error) => error instanceof IntegrationError && error.status === 400,
  );
  await assert.rejects(
    () => readIntegrationJson(create('{}', 'text/plain')),
    (error) => error instanceof IntegrationError && error.status === 415,
  );
  await assert.rejects(
    () => readIntegrationJson(create('x'.repeat(17000))),
    (error) => error instanceof IntegrationError && error.status === 413,
  );
});
void test('versioned boundary enforces credentials, scope, CORS, shared limits and redacted responses/logs', async (t) => {
  const generated = await generateIntegrationCredential('test');
  const metadata: Record<string, string | number | null>[] = [];
  const records: unknown[] = [];
  let authenticated: IntegrationContext | null = {
    ...context,
    keyId: generated.id,
  };
  let limited = false;
  let failure = false;
  const deps: IntegrationApiDependencies = {
    async authenticate(id, digest, mode) {
      assert.equal(id, generated.id);
      assert.equal(digest, generated.digest);
      assert.equal(mode, 'test');
      return authenticated;
    },
    async limit(bucket) {
      if (failure) throw new Error('private database detail');
      return { allowed: !limited || bucket === 'global:v1', retryAfter: 17 };
    },
    async record(input) {
      records.push(input);
    },
    log: (input) => metadata.push(input),
  };
  const handler = integrationApiHandler(
    deps,
    'integration:read',
    'integration.introspect',
    integrationIntrospection,
  );
  const request = (
    extra: Record<string, string> = {},
    method = 'GET',
    credential = generated.credential,
  ) =>
    new Request('https://tickets.test/api/v1/integration?private=never-log', {
      method,
      headers: { Authorization: `Bearer ${credential}`, ...extra },
    });
  await t.test(
    'valid credential returns stable Phase 1 schema and no secret/digest',
    async () => {
      const response = await handler(request());
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control')!, /no-store/);
      const text = await response.text();
      assert.ok(!text.includes(generated.credential));
      assert.ok(!text.includes(generated.digest));
      const result = JSON.parse(text);
      assert.equal(result.data.environment, 'test');
      assert.equal(result.data.capabilities.hosted_checkout, false);
      assert.equal(
        result.meta.request_id,
        response.headers.get('x-request-id'),
      );
      assert.ok(!response.headers.has('access-control-allow-origin'));
    },
  );
  await t.test(
    'invalid/missing/expired-or-revoked authentication is generic',
    async () => {
      assert.equal((await handler(request({}, 'GET', 'invalid'))).status, 401);
      assert.equal(
        (await handler(new Request('https://tickets.test/api/v1/integration')))
          .status,
        401,
      );
      authenticated = null;
      assert.equal((await handler(request())).status, 401);
      authenticated = { ...context, keyId: generated.id };
    },
  );
  await t.test('valid key does not imply missing scopes', async () => {
    authenticated = { ...context, keyId: generated.id, scopes: [] };
    const response = await handler(request());
    assert.equal(response.status, 403);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      'INSUFFICIENT_SCOPE',
    );
    authenticated = { ...context, keyId: generated.id };
  });
  await t.test(
    'browser calls/preflight and unsupported methods are rejected',
    async () => {
      assert.equal(
        (await handler(request({ Origin: 'https://partner.test' }))).status,
        403,
      );
      assert.equal(
        (await handler(request({ Origin: 'https://partner.test' }, 'OPTIONS')))
          .status,
        403,
      );
      assert.equal((await handler(request({}, 'POST'))).status, 405);
    },
  );
  await t.test(
    'rate limits have retry metadata and outages fail closed',
    async () => {
      limited = true;
      const response = await handler(request());
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '17');
      limited = false;
      failure = true;
      const failed = await handler(request());
      assert.equal(failed.status, 503);
      assert.ok(!(await failed.text()).includes('private database detail'));
      failure = false;
    },
  );
  await t.test(
    'usage logs never contain authentication, queries or raw private errors',
    () => {
      const all = JSON.stringify({ metadata, records });
      assert.ok(!all.includes(generated.credential));
      assert.ok(!all.includes(generated.digest));
      assert.ok(!all.includes('never-log'));
      assert.ok(!all.includes('private database detail'));
    },
  );
});
void test('two handler instances use the same shared rate store rather than per-process counters', async () => {
  const generated = await generateIntegrationCredential('test');
  const counts = new Map<string, number>();
  const deps: IntegrationApiDependencies = {
    authenticate: async () => ({ ...context, keyId: generated.id }),
    limit: async (bucket, max) => {
      const count = (counts.get(bucket) || 0) + 1;
      counts.set(bucket, count);
      return { allowed: count <= max, retryAfter: 10 };
    },
  };
  const first = integrationApiHandler(
    deps,
    'integration:read',
    'integration.introspect',
    integrationIntrospection,
  );
  const second = integrationApiHandler(
    deps,
    'integration:read',
    'integration.introspect',
    integrationIntrospection,
  );
  const req = () =>
    new Request('https://tickets.test/api/v1/integration', {
      headers: { Authorization: `Bearer ${generated.credential}` },
    });
  for (let i = 0; i < 60; i++)
    assert.equal((await (i % 2 ? first : second)(req())).status, 200);
  assert.equal((await first(req())).status, 429);
});
