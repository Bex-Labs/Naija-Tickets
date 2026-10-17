import assert from 'node:assert/strict';
import test from 'node:test';
import { generateIntegrationCredential } from './integrations/keys.ts';
import { parseIntegrationKey } from './integrations/validation.ts';
import {
  integrationIntrospection,
  type IntegrationApiDependencies,
} from './integrations/api.ts';
import { integrationDatabaseError } from './integrations/errors.ts';
import {
  integrationEventHandler,
  parseEventReadQuery,
  projectIntegrationEvent,
  projectIntegrationTicket,
  type EventReadDependencies,
  type EventReadOperation,
} from './integrations/events.ts';
import type { IntegrationContext } from './integrations/types.ts';
const id = '10000000-0000-4000-8000-000000000001';
const context: IntegrationContext = {
  keyId: id,
  integrationId: id,
  organiserId: id,
  environment: 'live',
  scopes: [
    'integration:read',
    'events:read',
    'tickets:read',
    'availability:read',
  ],
  name: 'Website',
  expiresAt: '2027-01-01T00:00:00Z',
};
const event = {
  id,
  title: 'Show',
  slug: 'show',
  description: 'Event description',
  image_url: 'https://example.com/show.jpg',
  venue_name: 'Hall',
  address: 'Road',
  city: 'Lagos',
  state: 'Lagos',
  starts_at: '2026-11-01T12:00:00.123456+01:00',
  ends_at: '2026-11-01T14:00:00+01:00',
  timezone: 'Africa/Lagos',
  sales_start_at: null,
  sales_end_at: null,
  organiser: {
    id,
    name: 'Public organiser',
    verified: true,
    contact_email: 'PRIVATE@example.com',
    nin: 'PRIVATE',
  },
  category: { id, name: 'Concert', slug: 'concert' },
  rejection_reason: 'PRIVATE',
  purchaser_email: 'PRIVATE@example.com',
};
const ticket = {
  id,
  event_id: id,
  name: 'Squad Pass',
  description: 'Five admissions',
  price_kobo: '4500000',
  standard_price_kobo: '4500000',
  price_kind: 'standard',
  early_bird_price_kobo: null,
  early_bird_ends_at: null,
  admissions_per_ticket: 5,
  min_packages_per_order: 1,
  max_packages_per_order: 6,
  sales_start_at: null,
  sales_end_at: null,
  sale_status: 'open',
  sort_order: 0,
  remaining_packages: 99,
  quantity_sold: 9,
  attendee_email: 'PRIVATE',
};
void test('public projections explicitly omit PII, inventory without availability permission, unsafe images and unsafe integer prices', () => {
  const projected = projectIntegrationEvent(event);
  assert.equal(projected.organiser.name, 'Public organiser');
  assert.equal(projected.image_url, 'https://example.com/show.jpg');
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
  assert.equal(
    projectIntegrationEvent({ ...event, image_url: 'javascript:alert(1)' })
      .image_url,
    null,
  );
  assert.equal(
    projectIntegrationEvent({
      ...event,
      image_url: 'https://user:secret@example.com/image.jpg',
    }).image_url,
    null,
  );
  const tier = projectIntegrationTicket(ticket);
  assert.equal(tier.price_kobo, 4500000);
  assert.equal(tier.currency, 'NGN');
  assert.ok(!('remaining_packages' in tier));
  assert.ok(!JSON.stringify(tier).includes('PRIVATE'));
  for (const price of ['9007199254740993', '-1', '1.2', 'Infinity'])
    assert.throws(() =>
      projectIntegrationTicket({ ...ticket, price_kobo: price }),
    );
});
void test('date/query validation rejects bad or repeated filters and permits only documented bounded pages', async () => {
  const parse = (query: string, op: EventReadOperation = 'list') =>
    parseEventReadQuery(
      new Request('https://tickets.test/api/v1/events' + query),
      context,
      op,
      null,
    );
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?limit=01',
    '?limit=1&limit=2',
    '?private=true',
    '?city=',
    '?category=Concert',
    '?starts_from=2026-10-20',
    '?starts_from=2026-02-30T00:00:00Z',
    '?starts_from=2026-11-01T00:00:00.123456Z',
    '?starts_from=2026-11-02T00:00:00Z&starts_before=2026-11-01T00:00:00Z',
    '?cursor=bad',
    '?cursor=' + 'x'.repeat(1025),
  ])
    await assert.rejects(parse(query));
  await assert.rejects(parse('?city=Lagos', 'tickets'));
  await assert.rejects(parse('?limit=1', 'availability'));
  assert.equal((await parse('')).query.limit, 20);
  assert.equal((await parse('?limit=100')).query.limit, 100);
  assert.equal(
    (await parse('?starts_from=2026-11-01T01:00:00%2B01:00')).query.startsFrom,
    '2026-11-01T00:00:00.000Z',
  );
});
void test('Phase 2 scope issuance is opt-in; introspection distinguishes live reads from unavailable test resources', () => {
  assert.deepEqual(parseIntegrationKey({ environment: 'live' }).scopes, [
    'integration:read',
  ]);
  assert.deepEqual(
    parseIntegrationKey({
      environment: 'live',
      scopes: ['events:read', 'availability:read'],
    }).scopes,
    ['events:read', 'availability:read'],
  );
  assert.equal(integrationIntrospection(context).capabilities.event_api, true);
  assert.equal(
    integrationIntrospection({ ...context, environment: 'test' }).capabilities
      .event_api,
    false,
  );
  assert.equal(
    integrationIntrospection(context).capabilities.hosted_checkout,
    false,
  );
});
void test('all resource routes retain authentication, independent scopes, shared limits, Origin rejection and safe errors', async (t) => {
  const key = await generateIntegrationCredential('live');
  for (const operation of [
    'list',
    'detail',
    'tickets',
    'availability',
  ] as const)
    await t.test(operation, async () => {
      let identity: IntegrationContext | null = { ...context, keyId: key.id };
      let reads = 0;
      let fail = false;
      let limited = false;
      const limits: string[] = [];
      const logs: unknown[] = [];
      const api: IntegrationApiDependencies = {
        authenticate: async () => identity,
        limit: async (bucket) => {
          limits.push(bucket);
          return { allowed: !limited, retryAfter: 7 };
        },
        log: (v) => logs.push(v),
      };
      const resources: EventReadDependencies = {
        read: async (proof) => {
          reads++;
          assert.equal(proof.digest, key.digest);
          assert.equal(proof.keyId, key.id);
          assert.equal(proof.environment, 'live');
          if (fail) throw Error('SECRET database implementation');
          return {
            rows:
              operation === 'tickets'
                ? [ticket]
                : operation === 'availability'
                  ? [
                      {
                        event_id: id,
                        as_of: event.starts_at,
                        total_admissions: 5,
                        sold_admissions: 0,
                        reserved_admissions: 0,
                        remaining_admissions: 5,
                        ticket_types: [],
                      },
                    ]
                  : [event],
            as_of: event.starts_at,
          };
        },
      };
      const handler = integrationEventHandler(
        api,
        resources,
        operation,
        operation === 'list' ? null : id,
      );
      const request = (
        extra: Record<string, string> = {},
        method = 'GET',
        credential = key.credential,
        query = '',
      ) =>
        new Request('https://tickets.test/api/v1/events' + query, {
          method,
          headers: { Authorization: `Bearer ${credential}`, ...extra },
        });
      const valid = await handler(request());
      assert.equal(valid.status, 200);
      assert.match(valid.headers.get('cache-control')!, /no-store/);
      assert.ok(!valid.headers.has('access-control-allow-origin'));
      assert.equal(reads, 1);
      assert.ok(limits.includes('global:v1'));
      assert.ok(limits.includes(`key:${key.id}`));
      assert.ok(limits.includes(`integration:${context.integrationId}`));
      assert.ok(limits.includes(`organiser:${context.organiserId}`));
      assert.equal(
        (await handler(request({ Origin: 'https://partner.test' }))).status,
        403,
      );
      assert.equal(reads, 1);
      const wrongMethod = await handler(request({}, 'POST'));
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.headers.get('allow'), 'GET');
      assert.equal((await handler(request({}, 'GET', 'invalid'))).status, 401);
      identity = { ...context, keyId: key.id, scopes: ['integration:read'] };
      assert.equal((await handler(request())).status, 403);
      assert.equal(reads, 1);
      identity = null;
      assert.equal((await handler(request())).status, 401);
      identity = { ...context, keyId: key.id };
      assert.equal(
        (
          await handler(
            request({}, 'GET', key.credential, '?private=SECRET_QUERY'),
          )
        ).status,
        400,
      );
      assert.equal(reads, 1);
      limited = true;
      const throttled = await handler(request());
      assert.equal(throttled.status, 429);
      assert.equal(throttled.headers.get('retry-after'), '7');
      limited = false;
      fail = true;
      const failure = await handler(request());
      assert.equal(failure.status, 503);
      assert.ok(!(await failure.text()).includes('SECRET'));
      const safe = JSON.stringify(logs);
      assert.ok(!safe.includes(key.credential));
      assert.ok(!safe.includes(key.digest));
      assert.ok(!safe.includes('SECRET_QUERY'));
    });
});
void test('opaque page cursor is bound to application, environment, resource and filters; microseconds survive round trip', async () => {
  const key = await generateIntegrationCredential('live');
  const api: IntegrationApiDependencies = {
    authenticate: async () => context,
    limit: async () => ({ allowed: true, retryAfter: 1 }),
  };
  const resources: EventReadDependencies = {
    read: async () => ({
      rows: [event, { ...event, id: '10000000-0000-4000-8000-000000000002' }],
      as_of: event.starts_at,
    }),
  };
  const response = await integrationEventHandler(
    api,
    resources,
    'list',
  )(
    new Request('https://tickets.test/api/v1/events?limit=1', {
      headers: { Authorization: `Bearer ${key.credential}` },
    }),
  );
  const body = JSON.parse(await response.text());
  const url =
    'https://tickets.test/api/v1/events?cursor=' + body.meta.next_cursor;
  const parsed = await parseEventReadQuery(
    new Request(url),
    context,
    'list',
    null,
  );
  assert.equal(parsed.query.afterStart, event.starts_at);
  await assert.rejects(
    parseEventReadQuery(
      new Request(url),
      { ...context, integrationId: crypto.randomUUID() },
      'list',
      null,
    ),
  );
  await assert.rejects(
    parseEventReadQuery(
      new Request(url),
      { ...context, environment: 'test' },
      'list',
      null,
    ),
  );
  await assert.rejects(
    parseEventReadQuery(
      new Request(url + '&city=Lagos'),
      context,
      'list',
      null,
    ),
  );
});
void test('resource RPC denial codes are stable and do not expose database/provider messages', () => {
  const expected = {
    NT401: [401, 'INVALID_API_KEY'],
    NT403: [403, 'INSUFFICIENT_SCOPE'],
    NT404: [404, 'NOT_FOUND'],
    NT503: [503, 'SANDBOX_NOT_CONFIGURED'],
  };
  for (const [code, [status, errorCode]] of Object.entries(expected)) {
    const mapped = integrationDatabaseError({
      code,
      message: 'PRIVATE DETAIL',
    });
    assert.equal(mapped.status, status);
    assert.equal(mapped.code, errorCode);
    assert.ok(!mapped.message.includes('PRIVATE'));
  }
});

void test('the published OpenAPI schemas match actual event/ticket/availability projections and route scopes', async () => {
  const { readFileSync } = await import('node:fs');
  const { projectIntegrationAvailability } =
    await import('./integrations/events.ts');
  const spec = JSON.parse(
    readFileSync(
      new URL('../docs/integrations-phase2-openapi.json', import.meta.url),
      'utf8',
    ),
  );
  type Schema = {
    $ref?: string;
    type?: string | string[];
    const?: unknown;
    enum?: unknown[];
    properties?: Record<string, Schema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: Schema;
    minimum?: number;
    maximum?: number;
    maxItems?: number;
  };
  const validate = (value: unknown, schema: Schema): void => {
    if (schema.$ref)
      return validate(
        value,
        spec.components.schemas[schema.$ref.split('/').at(-1)!],
      );
    if ('const' in schema) assert.deepEqual(value, schema.const);
    if (schema.enum) assert.ok(schema.enum.includes(value));
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual =
      value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value === 'number' && Number.isInteger(value)
            ? 'integer'
            : typeof value;
    assert.ok(
      types.includes(actual),
      `Expected ${types.join(', ')}, got ${actual}`,
    );
    if (typeof value === 'number') {
      if (schema.minimum !== undefined) assert.ok(value >= schema.minimum);
      if (schema.maximum !== undefined) assert.ok(value <= schema.maximum);
    }
    if (Array.isArray(value)) {
      if (schema.maxItems !== undefined)
        assert.ok(value.length <= schema.maxItems);
      for (const item of value) validate(item, schema.items!);
    } else if (value !== null && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      for (const key of schema.required ?? [])
        assert.ok(key in object, `Missing ${key}`);
      if (schema.additionalProperties === false)
        assert.deepEqual(
          Object.keys(object).sort(),
          Object.keys(schema.properties!).sort(),
        );
      for (const [key, child] of Object.entries(schema.properties ?? {}))
        if (key in object) validate(object[key], child);
    }
  };
  validate(projectIntegrationEvent(event), spec.components.schemas.Event);
  validate(
    projectIntegrationTicket(ticket),
    spec.components.schemas.TicketType,
  );
  const availability = {
    event_id: id,
    as_of: event.starts_at,
    total_admissions: 50,
    sold_admissions: 10,
    reserved_admissions: 0,
    remaining_admissions: 40,
    ticket_types: [
      {
        ticket_type_id: id,
        admissions_per_ticket: 5,
        total_admissions: 50,
        sold_admissions: 10,
        reserved_admissions: 0,
        remaining_admissions: 40,
        remaining_packages: 8,
        early_bird_remaining_packages: null,
        max_packages_at_current_price: 6,
        sale_status: 'open',
      },
    ],
  };
  validate(
    projectIntegrationAvailability(availability),
    spec.components.schemas.Availability,
  );
  for (const [path, scope] of Object.entries({
    '/api/v1/events': 'events:read',
    '/api/v1/events/{eventId}': 'events:read',
    '/api/v1/events/{eventId}/tickets': 'tickets:read',
    '/api/v1/events/{eventId}/availability': 'availability:read',
  }))
    assert.equal(spec.paths[path].get['x-required-scope'], scope);
  assert.ok(
    !Object.keys(spec.paths).some(
      (path) => path.includes('checkout') || path.includes('orders'),
    ),
  );
});
