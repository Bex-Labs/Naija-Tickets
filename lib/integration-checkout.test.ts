import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  hostedSessionSecret,
  validateSigningKeys,
} from './integrations/checkout-access.ts';
import {
  parseCheckoutIntent,
  createCheckoutSessionHandler,
  checkoutSessionStatusHandler,
  projectCheckoutSession,
  type CheckoutSessionDependencies,
  type StoredCheckoutSession,
} from './integrations/checkout-sessions.ts';
import {
  integrationResourceMode,
  requireHostedPaymentMode,
} from './integrations/resource-mode.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
import { IntegrationError } from './integrations/errors.ts';
import type { IntegrationContext } from './integrations/types.ts';
import { authenticatedDestination } from './auth-destination.ts';
const id = '10000000-0000-4000-8000-000000000001';
const context: IntegrationContext = {
  keyId: id,
  integrationId: id,
  organiserId: id,
  environment: 'live',
  scopes: ['integration:read', 'checkout:write', 'orders:read'],
  name: 'Partner',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
const signing = {
  activeVersion: 'v1',
  keys: { v1: 'test-fixture-not-a-deployment-secret-' + 'x'.repeat(50) },
};
const body = {
  event_id: id,
  items: [{ ticket_type_id: id, quantity: 2 }],
  return_url: 'https://partner.example/complete',
};
void test('session HMACs are deterministic, purpose/mode/expiry/version bound and recoverable across bounded signing rotation', async () => {
  const session = {
    id,
    environment: 'live' as const,
    expires_at: '2026-11-01T00:00:00.123Z',
    signing_key_version: 'v1',
  };
  const access = await hostedSessionSecret(session, 'access', signing);
  assert.match(access, /^[a-f0-9]{64}$/);
  assert.equal(access, await hostedSessionSecret(session, 'access', signing));
  assert.notEqual(
    access,
    await hostedSessionSecret(session, 'reservation', signing),
  );
  assert.notEqual(
    access,
    await hostedSessionSecret(
      { ...session, environment: 'test' },
      'access',
      signing,
    ),
  );
  assert.notEqual(
    access,
    await hostedSessionSecret(
      { ...session, expires_at: '2026-11-02T00:00:00Z' },
      'access',
      signing,
    ),
  );
  const rotated = {
    activeVersion: 'v2',
    keys: { ...signing.keys, v2: 'another-isolated-fixture-' + 'y'.repeat(50) },
  };
  assert.equal(access, await hostedSessionSecret(session, 'access', rotated));
  await assert.rejects(
    hostedSessionSecret(
      { ...session, signing_key_version: 'constructor' },
      'access',
      signing,
    ),
  );
  assert.throws(() =>
    validateSigningKeys({ activeVersion: 'v1', keys: { v1: 'short' } }),
  );
});
void test('checkout intent rejects prices, customer impersonation, duplicate types, bad quantities and unsafe return addresses', () => {
  const valid = parseCheckoutIntent(body, context);
  assert.equal(valid.cancel_url, valid.return_url);
  assert.equal(valid.promo_code, null);
  for (const invalid of [
    { ...body, price_kobo: 1 },
    { ...body, customer_id: id },
    { ...body, items: [{ ...body.items[0], price: 1 }] },
    { ...body, items: [body.items[0], body.items[0]] },
    { ...body, items: [{ ticket_type_id: id, quantity: 21 }] },
    { ...body, items: [{ ticket_type_id: id, quantity: '2' }] },
    ...[
      'http://partner.example/done',
      'https://user:secret@partner.example/done',
      '//partner.example/done',
      'https://partner.example/done?email=x',
      'https://partner.example/done#x',
      'https://partner.example/done%0a',
    ].map((return_url) => ({ ...body, return_url })),
  ])
    assert.throws(
      () => parseCheckoutIntent(invalid, context),
      IntegrationError,
    );
  assert.equal(
    parseCheckoutIntent(
      { ...body, return_url: 'http://localhost:3001/done' },
      { ...context, environment: 'test' },
    ).return_url,
    'http://localhost:3001/done',
  );
});
void test('sandbox requires distinct projects, matching source URL and a test provider key; payment mode has no live fallback', () => {
  const settings = {
    INTEGRATIONS_RESOURCE_MODE: 'test',
    INTEGRATIONS_SANDBOX_PROJECT_REF: 'a'.repeat(20),
    INTEGRATIONS_LIVE_PROJECT_REF: 'b'.repeat(20),
    NEXT_PUBLIC_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`,
    PAYSTACK_SECRET_KEY: 'sk_test_fixture',
    INTEGRATIONS_CHECKOUT_ENABLED: 'true',
  };
  assert.equal(integrationResourceMode(settings), 'test');
  assert.equal(integrationResourceMode({}), 'live');
  for (const change of [
    {
      INTEGRATIONS_LIVE_PROJECT_REF: settings.INTEGRATIONS_SANDBOX_PROJECT_REF,
    },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${'b'.repeat(20)}.supabase.co` },
    { PAYSTACK_SECRET_KEY: 'sk_live_fixture' },
    { INTEGRATIONS_SANDBOX_PROJECT_REF: '' },
  ])
    assert.throws(
      () => integrationResourceMode({ ...settings, ...change }),
      IntegrationError,
    );
  assert.throws(() =>
    requireHostedPaymentMode('test', {
      INTEGRATIONS_CHECKOUT_ENABLED: 'true',
      PAYSTACK_SECRET_KEY: 'sk_live_fixture',
    }),
  );
  assert.throws(() =>
    requireHostedPaymentMode('live', {
      INTEGRATIONS_CHECKOUT_ENABLED: 'true',
      PAYSTACK_SECRET_KEY: 'sk_test_fixture',
    }),
  );
});
void test('external session API replays one signed URL, enforces scope/Idempotency-Key and exposes only minimal order status', async () => {
  const credential = await generateIntegrationCredential('live');
  let identity: IntegrationContext | null = {
    ...context,
    keyId: credential.id,
  };
  let stored: {
    row: StoredCheckoutSession;
    hash: string;
    idem: string;
  } | null = null;
  let creates = 0;
  const logs: unknown[] = [];
  const api = {
    authenticate: async () => identity,
    limit: async () => ({ allowed: true, retryAfter: 1 }),
    log: (value: unknown) => logs.push(value),
  };
  const deps: CheckoutSessionDependencies = {
    signingKeys: () => signing,
    requireConfiguration: () => {},
    origin: () => 'https://tickets.example',
    create: async (proof, input) => {
      assert.equal(proof.digest, credential.digest);
      if (stored) {
        if (stored.hash !== input.payloadHash)
          throw new IntegrationError(409, 'IDEMPOTENCY_CONFLICT', 'Conflict');
        assert.equal(stored.idem, input.idempotencyDigest);
        return stored.row;
      }
      creates++;
      const row: StoredCheckoutSession = {
        ...input.session,
        event_id: id,
        integration_id: id,
        status: 'open',
        currency: 'NGN',
        admissions: 2,
        subtotal_kobo: null,
        discount_kobo: null,
        fee_kobo: null,
        total_kobo: null,
        reservation_expires_at: null,
        tickets_issued: 0,
        members_registered: 0,
        capability_hash: input.accessHash,
      };
      stored = { row, hash: input.payloadHash, idem: input.idempotencyDigest };
      return row;
    },
    status: async () => {
      if (!stored) throw Error('No session');
      return {
        ...stored.row,
        status: 'paid',
        subtotal_kobo: 100000,
        discount_kobo: 0,
        fee_kobo: 5000,
        total_kobo: 105000,
      };
    },
  };
  const handler = createCheckoutSessionHandler(api, deps);
  const request = (
    value: unknown = body,
    headers: Record<string, string> = {},
    method = 'POST',
  ) =>
    new Request('https://tickets.example/api/v1/checkout-sessions', {
      method,
      headers: {
        Authorization: `Bearer ${credential.credential}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-intent-001',
        ...headers,
      },
      ...(method === 'POST' ? { body: JSON.stringify(value) } : {}),
    });
  const first = await handler(request());
  assert.equal(first.status, 200);
  const original = JSON.parse(await first.text());
  assert.ok(
    original.data.checkout_url.startsWith(
      'https://tickets.example/integrations/checkout/',
    ),
  );
  const second = JSON.parse(await (await handler(request())).text());
  assert.equal(second.data.checkout_url, original.data.checkout_url);
  assert.equal(creates, 1);

  assert.equal(
    (
      await handler(
        request({ ...body, items: [{ ticket_type_id: id, quantity: 3 }] }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await handler(request(body, { 'Idempotency-Key': 'bad' }))).status,
    400,
  );
  assert.equal(
    (await handler(request(body, { Origin: 'https://partner.example' })))
      .status,
    403,
  );
  const wrongMethod = await handler(request(body, {}, 'GET'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  identity = { ...context, keyId: credential.id, scopes: ['orders:read'] };
  assert.equal((await handler(request())).status, 403);
  const status = await checkoutSessionStatusHandler(
    api,
    deps,
    original.data.id,
  )(
    new Request(
      'https://tickets.example/api/v1/checkout-sessions/' + original.data.id,
      { headers: { Authorization: `Bearer ${credential.credential}` } },
    ),
  );
  assert.equal(status.status, 200);
  const result = JSON.parse(await status.text());
  assert.equal(result.data.status, 'paid');
  assert.equal(result.data.total_kobo, 105000);
  assert.ok(!('checkout_url' in result.data));
  assert.ok(!('capability_hash' in result.data));
  assert.ok(!JSON.stringify(result).includes(credential.digest));
  assert.ok(!JSON.stringify(logs).includes(credential.credential));
  assert.ok(!JSON.stringify(logs).includes('access='));
});
void test('hosted login resumes a clean cookie-backed path, never an external return or capability in next', () => {
  assert.equal(
    authenticatedDestination(`/integrations/checkout/${id}`),
    `/integrations/checkout/${id}`,
  );
  assert.equal(
    authenticatedDestination(
      `/integrations/checkout/${id}?access=${'a'.repeat(64)}`,
    ),
    '/account',
  );
  assert.equal(authenticatedDestination('//evil.example'), '/account');
});
void test('unsafe numeric order data fails closed and committed status has no private purchaser/QR/order bearer fields', () => {
  const row: StoredCheckoutSession = {
    id,
    environment: 'live',
    expires_at: new Date().toISOString(),
    signing_key_version: 'v1',
    event_id: id,
    integration_id: id,
    status: 'paid',
    currency: 'NGN',
    admissions: 2,
    subtotal_kobo: 100000,
    discount_kobo: 0,
    fee_kobo: 5000,
    total_kobo: 105000,
    reservation_expires_at: null,
    tickets_issued: 2,
    members_registered: 0,
    capability_hash: 'a'.repeat(64),
  };
  const projected = projectCheckoutSession(row);
  const spec = JSON.parse(
    readFileSync(
      new URL('../docs/integrations-phase3-openapi.json', import.meta.url),
      'utf8',
    ),
  );
  const contract = spec.components.schemas.CheckoutSession;
  assert.deepEqual(Object.keys(projected).sort(), contract.required.toSorted());
  assert.deepEqual(
    Object.keys(projected).sort(),
    Object.keys(contract.properties).sort(),
  );
  assert.equal(contract.additionalProperties, false);
  assert.equal(
    spec.paths['/api/v1/checkout-sessions'].post['x-required-scope'],
    'checkout:write',
  );
  assert.equal(
    spec.paths['/api/v1/checkout-sessions/{sessionId}'].get['x-required-scope'],
    'orders:read',
  );
  assert.ok(contract.properties.status.enum.includes(projected.status));
  assert.equal(projected.total_kobo, 105000);
  assert.ok(!JSON.stringify(projected).includes('capability_hash'));
  assert.throws(() =>
    projectCheckoutSession({ ...row, total_kobo: 9007199254740992 }),
  );
});
