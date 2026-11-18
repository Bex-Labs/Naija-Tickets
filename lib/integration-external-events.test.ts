import assert from 'node:assert/strict';
import test from 'node:test';
import { externalEventUpsertHandler } from './integrations/external-events.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
import type { IntegrationApiDependencies } from './integrations/api.ts';
import type { IntegrationContext } from './integrations/types.ts';

const id = '10000000-0000-4000-8000-000000000001';
const context: IntegrationContext = {
  keyId: id,
  integrationId: id,
  organiserId: id,
  environment: 'test',
  scopes: ['external_events:write'],
  name: 'External event website',
  expiresAt: '2027-01-01T00:00:00.000Z',
};
const event = {
  title: 'Lagos Design Night',
  starts_at: '2026-12-12T18:00:00+01:00',
  ends_at: '2026-12-12T23:00:00+01:00',
  tickets: [
    {
      external_id: 'general',
      name: 'General admission',
      price_kobo: 4500000,
      quantity: 100,
    },
  ],
};

void test('external events are a server-only PUT endpoint with an opt-in scope and bounded identifier', async () => {
  const credential = await generateIntegrationCredential('test');
  let calls = 0;
  const api: IntegrationApiDependencies = {
    authenticate: async () => ({ ...context, keyId: credential.id }),
    limit: async () => ({ allowed: true, retryAfter: 1 }),
  };
  const handler = externalEventUpsertHandler(
    api,
    {
      upsert: async (proof, externalId, payload) => {
        calls++;
        assert.equal(proof.keyId, credential.id);
        assert.equal(proof.environment, 'test');
        assert.equal(externalId, 'event_2026_lagos');
        assert.deepEqual(payload, event);
        return {
          id,
          external_id: externalId,
          title: event.title,
          status: 'published',
        };
      },
    },
    'event_2026_lagos',
  );
  const request = (body: unknown = event, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${credential.credential}`);
    headers.set('Content-Type', 'application/json');
    return new Request(
      'https://tickets.example/api/v1/external-events/event_2026_lagos',
      {
        ...init,
        method: init.method || 'PUT',
        headers,
        body: JSON.stringify(body),
      },
    );
  };

  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as { data: unknown }).data, {
    id,
    external_id: 'event_2026_lagos',
    title: event.title,
    status: 'published',
  });
  assert.equal(calls, 1);
  assert.equal((await handler(request(event, { method: 'POST' }))).status, 405);
  assert.equal(
    (
      await handler(
        request(event, { headers: { Origin: 'https://partner.example' } }),
      )
    ).status,
    403,
  );
  const invalidId = externalEventUpsertHandler(
    api,
    { upsert: async () => ({}) },
    'not valid',
  );
  assert.equal((await invalidId(request())).status, 400);
});

void test('external event creation rejects malformed bodies and unavailable permission before persistence', async () => {
  let calls = 0;
  const api: IntegrationApiDependencies = {
    authenticate: async () => ({ ...context, scopes: ['events:read'] }),
    limit: async () => ({ allowed: true, retryAfter: 1 }),
  };
  const handler = externalEventUpsertHandler(
    api,
    {
      upsert: async () => {
        calls++;
        return {};
      },
    },
    'external-1',
  );
  const key = await generateIntegrationCredential('test');
  const response = await handler(
    new Request(
      'https://tickets.example/api/v1/external-events/external-1?bad=1',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${key.credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    ),
  );
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
  const permitted = externalEventUpsertHandler(
    { ...api, authenticate: async () => context },
    { upsert: async () => ({}) },
    'external-1',
  );
  const malformed = await permitted(
    new Request('https://tickets.example/api/v1/external-events/external-1', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${key.credential}`,
        'Content-Type': 'application/json',
      },
      body: '[]',
    }),
  );
  assert.equal(malformed.status, 400);
});
