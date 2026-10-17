import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
import {
  integrationEventHandler,
  type EventReadDependencies,
  type EventReadOperation,
} from './integrations/events.ts';
import { integrationDatabaseError } from './integrations/errors.ts';
import type { IntegrationApiDependencies } from './integrations/api.ts';
import type { IntegrationContext } from './integrations/types.ts';
const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
const owner = '10000000-0000-4000-8000-000000000001',
  org = '20000000-0000-4000-8000-000000000001',
  foreignOrg = '20000000-0000-4000-8000-000000000002';
const event = '30000000-0000-4000-8000-000000000001',
  second = '30000000-0000-4000-8000-000000000002',
  foreign = '30000000-0000-4000-8000-000000000003',
  draft = '30000000-0000-4000-8000-000000000004',
  past = '30000000-0000-4000-8000-000000000005',
  unassigned = '30000000-0000-4000-8000-000000000006',
  empty = '30000000-0000-4000-8000-000000000007';
const tier = '40000000-0000-4000-8000-000000000001',
  group = '40000000-0000-4000-8000-000000000002';
const allScopes = [
  'integration:read',
  'events:read',
  'tickets:read',
  'availability:read',
];
void test('Phase 2 reads reuse the real reservation/pricing engine and enforce tenant, mode and scope isolation', async (t) => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(migration('202609150002_event_detail_editor.sql'));
    const early = migration('202609170002_early_bird_ticket_pricing.sql');
    await db.exec(
      early.slice(
        early.indexOf('create function public.save_organiser_event_v2'),
        early.indexOf(
          'create or replace function public.create_checkout_reservation_v2',
        ),
      ),
    );
    for (const name of [
      '202609260002_group_tickets.sql',
      '202609260003_group_ticket_claims.sql',
      '202610100001_early_bird_quantity.sql',
      '202610130001_integration_foundation.sql',
    ])
      await db.exec(migration(name));
    // The real verification migration's field, without unrelated storage adapters.
    await db.exec(
      'alter table public.organisers add column verified_at timestamptz',
    );
    await db.exec(migration('202610140001_integration_event_reads.sql'));
    await db.exec(`insert into auth.users values('${owner}');
      insert into public.profiles(id,full_name) values('${owner}','Owner');
      insert into public.organisers(id,name,slug,contact_email,verified_at) values('${org}','Owner Events','owner-events','PRIVATE@example.com',now()),('${foreignOrg}','Other','other','OTHERPRIVATE@example.com',null);
      insert into public.organiser_memberships(organiser_id,user_id,title) values('${org}','${owner}','Owner');
      insert into public.categories(id,name,slug) values('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at,status,image_path)
      select id::uuid,organiser_id::uuid,'${owner}','Show '||n,'show-'||n,'Owner presents','Public description','Hall','Road',city,'Lagos',now()+interval '2 days',now()+interval '3 days',status::public.event_status,'https://example.com/event.jpg'
      from (values('${event}','${org}',1,'Lagos','published'),('${second}','${org}',2,'Abuja','published'),('${foreign}','${foreignOrg}',3,'Lagos','published'),('${draft}','${org}',4,'Lagos','draft'),('${past}','${org}',5,'Lagos','completed'),('${unassigned}','${org}',6,'Lagos','published'),('${empty}','${org}',7,'Lagos','published')) v(id,organiser_id,n,city,status);
      update public.events set starts_at=date_trunc('second',starts_at)+interval '0.123456 seconds';
      update public.events set ends_at=now()-interval '1 hour', starts_at=now()-interval '2 hours',status='published' where id='${past}';
      insert into public.ticket_types(id,event_id,name,price_kobo,standard_price_kobo,quantity_total,admissions_per_ticket,early_bird_price_kobo,early_bird_ends_at,early_bird_quantity)
      values('${tier}','${event}','General',100000,100000,20,1,50000,now()+interval '1 day',2),('${group}','${event}','Squad Pass',4500000,4500000,50,5,4000000,now()+interval '1 day',2);
      insert into public.ticket_types(event_id,name,price_kobo,quantity_total,active) values('${event}','Hidden',0,10,false);`);
    const app = (
      await db.query<{ app: { id: string } }>(
        "select public.save_organiser_integration($1,null,$2,'Partner','active','[]'::jsonb,$3::uuid[]) as app",
        [owner, org, [event, second, draft, past, empty]],
      )
    ).rows[0].app;
    const issue = async (
      mode: 'test' | 'live' = 'live',
      scopes = allScopes,
    ) => {
      const k = await generateIntegrationCredential(mode);
      await db.query(
        "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,$7,$8::text[],now()+interval '90 days',null)",
        [owner, app.id, k.id, k.digest, k.prefix, k.suffix, mode, scopes],
      );
      return { ...k, environment: mode };
    };
    const k = await issue();
    const deps: IntegrationApiDependencies = {
      authenticate: async (id, digest, mode) =>
        (
          await db.query<{ result: IntegrationContext | null }>(
            'select public.authenticate_integration_key($1,$2,$3) as result',
            [id, digest, mode],
          )
        ).rows[0].result,
      limit: async () => ({ allowed: true, retryAfter: 1 }),
      record: async (input) => {
        await db.query(
          'select public.record_integration_request($1,$2,$3,$4,$5,$6)',
          [
            input.requestId,
            input.keyId,
            input.route,
            input.status,
            input.errorCode,
            input.durationMs,
          ],
        );
      },
    };
    const resources: EventReadDependencies = {
      read: async (proof, operation, id, q) => {
        try {
          return (
            await db.query<{ result: { rows: unknown[]; as_of: string } }>(
              'select public.read_integration_events($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as result',
              [
                proof.keyId,
                proof.digest,
                proof.environment,
                operation,
                id,
                q.limit,
                q.city,
                q.category,
                q.startsFrom,
                q.startsBefore,
                q.afterId,
                q.afterStart,
                q.afterSort,
              ],
            )
          ).rows[0].result;
        } catch (cause) {
          throw integrationDatabaseError(cause);
        }
      },
    };
    const request = async (
      op: EventReadOperation = 'list',
      id: string | null = null,
      query = '',
      credential = k.credential,
    ) => {
      const response = await integrationEventHandler(
        deps,
        resources,
        op,
        id,
      )(
        new Request('https://tickets.test/api/v1/events' + query, {
          headers: { Authorization: `Bearer ${credential}` },
        }),
      );
      return { response, body: JSON.parse(await response.text()) };
    };
    const scenario = async (name: string, run: () => Promise<void>) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await run();
        } finally {
          await db.exec('rollback');
        }
      });
    // Failed SQL calls inside a transaction need a savepoint before wrapper
    // logging; for denial scenarios use autocommit, or shield resource calls.
    const originalRead = resources.read;
    resources.read = async (...args) => {
      const transactional =
        (
          await db.query<{ v: string }>(
            "select current_setting('test.transaction',true) as v",
          )
        ).rows[0].v === '1';
      if (!transactional) return originalRead(...args);
      await db.exec('savepoint api_read');
      try {
        const result = await originalRead(...args);
        await db.exec('release savepoint api_read');
        return result;
      } catch (error) {
        await db.exec(
          'rollback to savepoint api_read; release savepoint api_read',
        );
        throw error;
      }
    };
    await db.exec("select set_config('test.transaction','1',false)");
    await scenario(
      'only assigned published current events are returned and public schemas omit contact and buyer data',
      async () => {
        const { body, response } = await request();
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.deepEqual(
          body.data.map((e: { id: string }) => e.id),
          [event, second, empty],
        );
        assert.equal(body.meta.next_cursor, null);
        assert.ok(!JSON.stringify(body).includes('PRIVATE'));
        assert.ok(!JSON.stringify(body).includes('rejection_reason'));
        const detail = await request('detail', event);
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.data.organiser.verified, true);
        assert.equal(
          detail.body.data.image_url,
          'https://example.com/event.jpg',
        );
        for (const id of [
          foreign,
          unassigned,
          draft,
          past,
          crypto.randomUUID(),
        ]) {
          for (const op of ['detail', 'tickets', 'availability'] as const) {
            const denied = await request(op, id);
            assert.equal(
              denied.response.status,
              404,
              JSON.stringify(denied.body),
            );
            assert.equal(denied.body.error.code, 'NOT_FOUND');
          }
        }
        await db.query(
          "update public.events set status='cancelled' where id=$1",
          [event],
        );
        assert.equal((await request('detail', event)).response.status, 404);
      },
    );
    await scenario(
      'event and ticket keyset pages preserve timestamp microseconds, filters and stable ID tie breaks',
      async () => {
        const first = await request('list', null, '?limit=1');
        assert.equal(first.response.status, 200);
        assert.equal(first.body.data[0].id, event);
        assert.ok(first.body.meta.next_cursor);
        const next = await request(
          'list',
          null,
          '?limit=1&cursor=' + first.body.meta.next_cursor,
        );
        assert.equal(next.response.status, 200, JSON.stringify(next.body));
        assert.equal(next.body.data[0].id, second);
        const final = await request(
          'list',
          null,
          '?limit=1&cursor=' + next.body.meta.next_cursor,
        );
        assert.equal(final.body.data[0].id, empty);
        assert.equal(final.body.meta.next_cursor, null);
        const filtered = await request(
          'list',
          null,
          '?city=lagos&category=concert',
        );
        assert.deepEqual(
          filtered.body.data.map((e: { id: string }) => e.id),
          [event, empty],
        );
        assert.equal(
          (await request('list', null, '?category=unknown')).body.data.length,
          0,
        );
        const from = new Date(Date.now() + 4 * 86400000).toISOString();
        assert.equal(
          (
            await request(
              'list',
              null,
              '?starts_from=' + encodeURIComponent(from),
            )
          ).body.data.length,
          0,
        );
        assert.equal(
          (
            await request(
              'list',
              null,
              '?city=Abuja&cursor=' + first.body.meta.next_cursor,
            )
          ).response.status,
          400,
        );
        const tickets = await request('tickets', event, '?limit=1');
        assert.equal(tickets.body.data[0].id, tier);
        const ticketNext = await request(
          'tickets',
          event,
          '?limit=1&cursor=' + tickets.body.meta.next_cursor,
        );
        assert.equal(ticketNext.body.data[0].id, group);
        assert.equal(ticketNext.body.meta.next_cursor, null);
        assert.equal(
          (
            await request(
              'tickets',
              second,
              '?cursor=' + tickets.body.meta.next_cursor,
            )
          ).response.status,
          400,
        );
      },
    );
    await scenario(
      'resource scopes are independent; test mode cannot read live resources or use the reserved access predicate',
      async () => {
        const limited = await issue('live', ['tickets:read']);
        assert.equal(
          (await request('list', null, '', limited.credential)).response.status,
          403,
        );
        assert.equal(
          (await request('tickets', event, '', limited.credential)).response
            .status,
          200,
        );
        assert.equal(
          (await request('availability', event, '', limited.credential))
            .response.status,
          403,
        );
        const testKey = await issue('test');
        for (const op of [
          'list',
          'detail',
          'tickets',
          'availability',
        ] as const) {
          const denied = await request(
            op,
            op === 'list' ? null : event,
            '',
            testKey.credential,
          );
          assert.equal(denied.response.status, 503);
          assert.equal(denied.body.error.code, 'SANDBOX_NOT_CONFIGURED');
        }
        assert.equal(
          (
            await db.query<{ v: boolean }>(
              'select public.integration_key_can_access_event($1,$2,$3,$4,$5) as v',
              [testKey.id, testKey.digest, 'test', event, 'events:read'],
            )
          ).rows[0].v,
          false,
        );
        assert.equal(
          (
            await request(
              'list',
              null,
              '',
              k.credential.replace('nt_live_', 'nt_test_'),
            )
          ).response.status,
          401,
        );
      },
    );
    const reserve = async (
      ticketId = tier,
      quantity = 1,
      promo: string | null = null,
    ) =>
      (
        await db.query<{
          order_id: string;
          subtotal_kobo: string;
          total_kobo: string;
        }>(
          'select * from public.create_checkout_reservation_v3($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
          [
            owner,
            event,
            JSON.stringify([
              {
                ticket_type_id: ticketId,
                quantity,
                attendees:
                  ticketId === group
                    ? []
                    : Array.from({ length: quantity }, () => ({
                        name: 'Private Buyer',
                        email: 'privatebuyer@example.com',
                        phone: '08012345678',
                      })),
              },
            ]),
            JSON.stringify({
              name: 'Private Buyer',
              email: 'privatebuyer@example.com',
              phone: '08012345678',
            }),
            'a'.repeat(32) + crypto.randomUUID().replaceAll('-', ''),
            promo,
          ],
        )
      ).rows[0];
    await scenario(
      'prices match checkout including early bird exhaustion, expiry, release and promo separation; reads never mutate stored prices',
      async () => {
        const ticket = async () =>
          (await request('tickets', event)).body.data[0];
        assert.equal((await ticket()).price_kobo, 50000);
        const a = await reserve();
        assert.equal(Number(a.subtotal_kobo), 50000);
        const b = await reserve();
        assert.equal((await ticket()).price_kobo, 100000);
        await db.query(
          "update public.reservations set expires_at=now()-interval '1 second' where order_item_id in(select id from public.order_items where order_id=$1)",
          [a.order_id],
        );
        const availability = (await request('availability', event)).body.data
          .ticket_types[0];
        assert.equal(availability.reserved_admissions, 1);
        assert.equal(availability.remaining_admissions, 19);
        assert.equal(availability.early_bird_remaining_packages, 1);
        assert.equal((await ticket()).price_kobo, 50000);
        await db.query('select public.release_checkout_order($1)', [
          b.order_id,
        ]);
        assert.equal(
          (await request('availability', event)).body.data.ticket_types[0]
            .reserved_admissions,
          0,
        );
        await db.query(
          "update public.ticket_types set price_kobo=99999,early_bird_ends_at=now()-interval '1 second' where id=$1",
          [tier],
        );
        assert.equal((await ticket()).price_kobo, 100000);
        assert.equal(
          Number(
            (
              await db.query<{ price_kobo: string }>(
                'select price_kobo from public.ticket_types where id=$1',
                [tier],
              )
            ).rows[0].price_kobo,
          ),
          99999,
        );
        await db.query(
          "update public.ticket_types set early_bird_ends_at=now()+interval '1 day' where id=$1",
          [tier],
        );
        await db.exec(
          `insert into public.promo_codes(event_id,code,discount_type,discount_value,starts_at,ends_at,usage_limit) values('${event}','SAVE10','percentage',1000,now()-interval '1 hour',now()+interval '1 day',10)`,
        );
        const c = await reserve(tier, 1, 'SAVE10');
        assert.equal(Number(c.subtotal_kobo), 50000);
        assert.equal((await ticket()).promo_discount_included, false);
        assert.ok(
          !JSON.stringify((await request('tickets', event)).body).includes(
            'privatebuyer',
          ),
        );
      },
    );
    await scenario(
      'two group-of-five purchases reserve and sell ten admissions; paid unclaimed/refunded slots stay sold',
      async () => {
        const order = await reserve(group, 2);
        let inventory = (
          await request('availability', event)
        ).body.data.ticket_types.find(
          (v: { ticket_type_id: string }) => v.ticket_type_id === group,
        );
        assert.equal(inventory.reserved_admissions, 10);
        assert.equal(inventory.remaining_packages, 8);
        assert.equal(inventory.remaining_admissions, 40);
        assert.equal(inventory.max_packages_at_current_price, 6);
        const pay = (
          await db.query<{ payment_reference: string }>(
            'select * from public.prepare_paystack_payment($1,(select checkout_token_hash from public.orders where id=$1))',
            [order.order_id],
          )
        ).rows[0];
        await db.query(
          "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','123456','{}'::jsonb)",
          [pay.payment_reference, order.total_kobo],
        );
        inventory = (
          await request('availability', event)
        ).body.data.ticket_types.find(
          (v: { ticket_type_id: string }) => v.ticket_type_id === group,
        );
        assert.equal(inventory.sold_admissions, 10);
        assert.equal(inventory.reserved_admissions, 0);
        assert.equal(inventory.remaining_packages, 8);
        assert.equal(
          (
            await db.query(
              "select * from public.tickets where claim_state='UNCLAIMED'",
            )
          ).rows.length,
          10,
        );
        await db.query(
          "update public.orders set status='refunded' where id=$1",
          [order.order_id],
        );
        assert.equal(
          (await request('availability', event)).body.data.sold_admissions,
          10,
        );
      },
    );
    await scenario(
      'configured sale windows, whole packages, min/max and 400-admission restriction are reflected',
      async () => {
        await db.query(
          "update public.ticket_types set sales_start_at=now()+interval '1 hour' where id=$1",
          [tier],
        );
        assert.equal(
          (await request('tickets', event)).body.data[0].sale_status,
          'upcoming',
        );
        await db.query(
          "update public.ticket_types set sales_start_at=null,sales_end_at=now()-interval '1 hour' where id=$1",
          [tier],
        );
        assert.equal(
          (await request('tickets', event)).body.data[0].sale_status,
          'closed',
        );
        await db.query(
          'update public.ticket_types set quantity_sold=49,max_per_order=100 where id=$1',
          [group],
        );
        const availability = (await request('availability', event)).body.data
          .ticket_types[1];
        assert.equal(availability.remaining_admissions, 1);
        assert.equal(availability.remaining_packages, 0);
        assert.equal(availability.sale_status, 'sold_out');
        assert.equal(availability.max_packages_at_current_price, 0);
        assert.equal(
          (await request('tickets', event)).body.data[1].max_packages_per_order,
          80,
        );
        await db.query(
          "update public.events set sales_end_at=now()-interval '1 hour' where id=$1",
          [event],
        );
        assert.equal(
          (await request('tickets', event)).body.data[1].sale_status,
          'closed',
        );
        await db.query(
          'update public.events set sales_end_at=null where id=$1',
          [event],
        );
        await db.query(
          'update public.ticket_types set min_per_order=3 where id=$1',
          [tier],
        );
        await db.query(
          'update public.ticket_types set sales_end_at=null where id=$1',
          [tier],
        );
        assert.equal(
          (await request('tickets', event)).body.data[0].sale_status,
          'allocation_limited',
        );
        assert.equal(
          (await request('availability', event)).body.data.ticket_types[0]
            .max_packages_at_current_price,
          0,
        );
        assert.deepEqual((await request('tickets', empty)).body.data, []);
        assert.equal(
          (await request('availability', empty)).body.data.remaining_admissions,
          0,
        );
      },
    );
    await scenario(
      'removing grants, disabling, revoking and expiry are rechecked within the read transaction',
      async () => {
        await db.query(
          'delete from public.integration_event_grants where integration_id=$1 and event_id=$2',
          [app.id, event],
        );
        assert.equal((await request('detail', event)).response.status, 404);
        await db.query(
          "update public.integrations set status='disabled' where id=$1",
          [app.id],
        );
        assert.equal((await request()).response.status, 401);
        await db.query(
          "update public.integrations set status='active' where id=$1",
          [app.id],
        );
        await db.query(
          'update public.integration_api_keys set revoked_at=now() where id=$1',
          [k.id],
        );
        assert.equal((await request()).response.status, 401);
        const expired = await issue();
        await db.query(
          "update public.integration_api_keys set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1",
          [expired.id],
        );
        assert.equal(
          (await request('list', null, '', expired.credential)).response.status,
          401,
        );
        const proof = {
          keyId: k.id,
          digest: k.digest,
          environment: k.environment,
        };
        await assert.rejects(
          resources.read(proof, 'list', null, {
            limit: 20,
            city: null,
            category: null,
            startsFrom: null,
            startsBefore: null,
            afterId: null,
            afterStart: null,
            afterSort: null,
          }),
          /valid, active API key/,
        );
      },
    );
    await scenario(
      'browser roles cannot call read/snapshot RPCs or recover scope management; request logs use fixed labels',
      async () => {
        for (const role of ['anon', 'authenticated']) {
          await db.exec(`set role ${role}`);
          for (const sql of [
            "select public.read_integration_events(null,null,null,'list')",
            'select * from public.integration_ticket_snapshot(null)',
            'select public.require_integration_event_reader(null,null,null,null)',
          ]) {
            await db.exec('savepoint role_check');
            await assert.rejects(db.query(sql), /permission denied/);
            await db.exec(
              'rollback to savepoint role_check;release savepoint role_check',
            );
          }
          await db.exec('reset role');
        }
        await request('list');
        await request('detail', event);
        await request('tickets', event);
        await request('availability', event);
        const logs = (
          await db.query<{ route: string }>(
            'select distinct route from public.integration_request_logs',
          )
        ).rows.map((r) => r.route);
        assert.deepEqual(logs.sort(), [
          'events.availability',
          'events.detail',
          'events.list',
          'events.tickets',
        ]);
      },
    );
  } finally {
    await db.close();
  }
});
