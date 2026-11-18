import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advancedReadHandler,
  entryOperationHandler,
  parseAdvancedQuery,
  projectOperation,
  projectEntry,
  requireAdvancedConfiguration,
  type OperationsDependencies,
} from './integrations/operations.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
import type { IntegrationContext } from './integrations/types.ts';
import type { IntegrationApiDependencies } from './integrations/api.ts';
import { IntegrationError } from './integrations/errors.ts';
const id = '10000000-0000-4000-8000-000000000001';
const context: IntegrationContext = {
  keyId: id,
  integrationId: id,
  organiserId: id,
  environment: 'live',
  scopes: ['orders:read'],
  name: 'Test',
  expiresAt: '2030-01-01T00:00:00Z',
};
const order = {
  id,
  event_id: id,
  checkout_session_id: id,
  status: 'paid',
  currency: 'NGN',
  subtotal_kobo: 100,
  discount_kobo: 0,
  fee_kobo: 5,
  total_kobo: 105,
  created_at: '2026-10-01T00:00:00Z',
  paid_at: '2026-10-01T00:00:00Z',
  payment_status: 'verified',
  admissions: 1,
};
void test('advanced projections omit capabilities, purchaser data, provider payloads and contact fields without explicit contact permission', () => {
  const secrets = {
    reference: 'private-receipt',
    display_code: 'NT-SECRET',
    qr_token_hash: 'private-qr',
    invite_token: 'private-group',
    claim_access_token: 'private-ticket',
    purchaser_email: 'buyer@example.test',
    raw_verification: { secret: 'private' },
  };
  const projected = projectOperation('order', { ...order, ...secrets });
  assert.deepEqual(projected, order);
  const member = {
    ticket_id: id,
    order_id: id,
    event_id: id,
    group_booking_id: null,
    claim_state: 'CLAIMED',
    ticket_status: 'valid',
    personal_data_erased: false,
    name: 'Test attendee',
    email: 'attendee@example.test',
    phone: '08012345678',
    ...secrets,
  };
  const hidden = projectOperation('attendees', member);
  assert.ok(!('email' in hidden));
  assert.ok(!('phone' in hidden));
  assert.equal(
    (projectOperation('attendees', member, true) as { email: string }).email,
    member.email,
  );
  const erased = projectOperation(
    'attendees',
    { ...member, personal_data_erased: true },
    true,
  ) as { name: null; email: null; phone: null };
  assert.equal(erased.name, null);
  assert.equal(erased.email, null);
  assert.equal(erased.phone, null);
  assert.throws(() => projectOperation('tickets', { id }), IntegrationError);
  assert.throws(
    () =>
      projectOperation('order', {
        ...order,
        total_kobo: Number.MAX_SAFE_INTEGER + 1,
      }),
    IntegrationError,
  );
  assert.ok(
    !JSON.stringify(
      projectEntry({
        ticket_id: id,
        event_id: id,
        outcome: 'admitted',
        admitted: true,
        admission_limit: 1,
        admissions_used: 1,
        checked_in_at: '2026-10-01',
        replayed: false,
        ...secrets,
      }),
    ).includes('private'),
  );
});
void test('advanced query cursors are bound to application, mode, permissions, operation and filters', async () => {
  const key = await generateIntegrationCredential('live');
  const api: IntegrationApiDependencies = {
    authenticate: async () => context,
    limit: async () => ({ allowed: true, retryAfter: 60 }),
  };
  const deps: OperationsDependencies = {
    requireConfiguration: async () => {},
    read: async () => ({
      rows: [order, { ...order, id: '20000000-0000-4000-8000-000000000002' }],
    }),
    entry: async () => {
      throw Error('unused');
    },
  };
  const response = await advancedReadHandler(
    api,
    deps,
    'orders',
  )(
    new Request('https://tickets.example/api/v1/orders?limit=1', {
      headers: { Authorization: 'Bearer ' + key.credential },
    }),
  );
  const payload = (await response.json()) as {
    meta: { next_cursor: string };
    data: unknown[];
  };
  const cursor = payload.meta.next_cursor;
  assert.ok(cursor);
  assert.equal(payload.data.length, 1);
  assert.equal(
    (
      await parseAdvancedQuery(
        new Request('https://tickets.example/?cursor=' + cursor),
        context,
        'orders',
        null,
      )
    ).query.after,
    id,
  );
  for (const changed of [
    { ...context, integrationId: crypto.randomUUID() },
    { ...context, environment: 'test' as const },
    {
      ...context,
      scopes: [
        'orders:read',
        'attendees:contact',
      ] as IntegrationContext['scopes'],
    },
  ])
    await assert.rejects(
      () =>
        parseAdvancedQuery(
          new Request('https://tickets.example/?cursor=' + cursor),
          changed,
          'orders',
          null,
        ),
      IntegrationError,
    );
  for (const url of [
    '?cursor=' + cursor + '&event_id=' + id,
    '?limit=0',
    '?limit=101',
    '?limit=1&limit=2',
    '?email=private',
    '?cursor=broken',
  ])
    await assert.rejects(
      () =>
        parseAdvancedQuery(
          new Request('https://tickets.example/' + url),
          context,
          'orders',
          null,
        ),
      IntegrationError,
    );
  await assert.rejects(
    () =>
      parseAdvancedQuery(
        new Request('https://tickets.example/?limit=2'),
        context,
        'ticket',
        id,
      ),
    IntegrationError,
  );
});
void test('advanced server-key handlers fail closed for browser calls, scopes, methods, flags and failed limits without logging request data', async () => {
  const key = await generateIntegrationCredential('live');
  const logs: unknown[] = [];
  let called = 0;
  let current = context;
  const api: IntegrationApiDependencies = {
    authenticate: async () => current,
    limit: async () => ({ allowed: true, retryAfter: 60 }),
    log: (value) => {
      logs.push(value);
    },
  };
  const deps: OperationsDependencies = {
    requireConfiguration: async () => {},
    read: async () => {
      called++;
      return { rows: [order] };
    },
    entry: async () => {
      throw Error('unused');
    },
  };
  const handler = advancedReadHandler(api, deps, 'order', id);
  for (const [headers, method, status] of [
    [{ Origin: 'https://evil.example' }, 'GET', 403],
    [{}, 'POST', 405],
    [{}, 'GET', 200],
  ] as [Record<string, string>, string, number][]) {
    const result = await handler(
      new Request('https://tickets.example/api/v1/orders/' + id, {
        method,
        headers: { Authorization: 'Bearer ' + key.credential, ...headers },
      }),
    );
    assert.equal(result.status, status);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal(called, 1);
  current = { ...context, scopes: ['events:read'] };
  assert.equal(
    (
      await handler(
        new Request('https://tickets.example/', {
          headers: { Authorization: 'Bearer ' + key.credential },
        }),
      )
    ).status,
    403,
  );
  current = context;
  assert.equal(
    (
      await advancedReadHandler(
        { ...api, limit: async () => ({ allowed: false, retryAfter: 12 }) },
        deps,
        'order',
        id,
      )(
        new Request('https://tickets.example/', {
          headers: { Authorization: 'Bearer ' + key.credential },
        }),
      )
    ).status,
    429,
  );
  assert.ok(!JSON.stringify(logs).includes(key.credential));
  assert.throws(
    () => requireAdvancedConfiguration(context, false, {}),
    IntegrationError,
  );
  requireAdvancedConfiguration(context, false, {
    INTEGRATIONS_ADVANCED_ENABLED: 'true',
  });
  assert.throws(
    () =>
      requireAdvancedConfiguration(context, true, {
        INTEGRATIONS_ADVANCED_ENABLED: 'true',
      }),
    IntegrationError,
  );
  assert.throws(
    () =>
      requireAdvancedConfiguration({ ...context, environment: 'test' }, false, {
        INTEGRATIONS_ADVANCED_ENABLED: 'true',
      }),
    IntegrationError,
  );
});
void test('entry requires explicit verify plus check-in scope, bounded native codes and stable idempotency, and rejects injected identities/prices', async () => {
  const key = await generateIntegrationCredential('live');
  let current = {
    ...context,
    scopes: ['entry:verify'] as IntegrationContext['scopes'],
  };
  let entries = 0;
  const api: IntegrationApiDependencies = {
    authenticate: async () => current,
    limit: async () => ({ allowed: true, retryAfter: 60 }),
  };
  const deps: OperationsDependencies = {
    requireConfiguration: async () => {},
    read: async () => ({ rows: [] }),
    entry: async (_proof, input) => {
      entries++;
      assert.match(input.idempotencyDigest, /^[a-f0-9]{64}$/);
      assert.equal(input.code, 'NT-123456ABCDEF');
      return {
        ticket_id: id,
        event_id: id,
        outcome: 'valid',
        admitted: false,
        admission_limit: 1,
        admissions_used: 0,
        checked_in_at: null,
        replayed: false,
      };
    },
  };
  const handler = entryOperationHandler(api, deps, id);
  const send = (body: unknown, idem: string | undefined = 'entry-test-001') =>
    handler(
      new Request(
        'https://tickets.example/api/v1/events/' + id + '/check-ins',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + key.credential,
            'Content-Type': 'application/json',
            ...(idem ? { 'Idempotency-Key': idem } : {}),
          },
          body: JSON.stringify(body),
        },
      ),
    );
  assert.equal(
    (await send({ code: 'nt-123456abcdef', action: 'verify' })).status,
    200,
  );
  assert.equal(
    (await send({ code: 'NT-123456ABCDEF', action: 'admit' })).status,
    403,
  );
  current = { ...current, scopes: ['entry:verify', 'entry:check-in'] };
  assert.equal(
    (await send({ code: 'NT-123456ABCDEF', action: 'admit' })).status,
    200,
  );
  for (const body of [
    { code: 'NT-123456ABCDEF', action: 'admit', staff_id: id },
    { code: 'NT-123456ABCDEF', action: 'admit', price: 0 },
    { code: 'https://tickets.example/private', action: 'admit' },
    { code: 'NT-123456ABCDEF', action: 'refund' },
  ])
    assert.equal((await send(body)).status, 400);
  assert.equal(
    (await send({ code: 'NT-123456ABCDEF', action: 'admit' }, '')).status,
    400,
  );
  assert.equal(entries, 2);
});
