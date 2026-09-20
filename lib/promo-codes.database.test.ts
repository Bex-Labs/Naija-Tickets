import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('promo codes use authoritative PostgreSQL checkout and access rules', async (t) => {
  const db = await createPromoTestDatabase();
  const owner = '10000000-0000-4000-8000-000000000001';
  const outsider = '10000000-0000-4000-8000-000000000002';
  const eventId = '20000000-0000-4000-8000-000000000001';
  const otherEventId = '20000000-0000-4000-8000-000000000002';
  const tier = '30000000-0000-4000-8000-000000000001';
  const vip = '30000000-0000-4000-8000-000000000002';
  const foreignTier = '30000000-0000-4000-8000-000000000003';
  await db.exec(`
    insert into auth.users values ('${owner}'), ('${outsider}');
    insert into public.profiles(id,full_name) values ('${owner}', 'Owner One'), ('${outsider}', 'Other Owner');
    insert into public.organisers(id,name,slug,contact_email) values ('${owner}', 'Owner', 'owner', 'owner@example.com'), ('${outsider}', 'Other', 'other', 'other@example.com');
    insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}', '${owner}'), ('${outsider}', '${outsider}');
    insert into public.categories(id,name,slug) values ('${owner}', 'Concert', 'concert');
    insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
    values ('${eventId}', '${owner}', '${owner}', 'Show', 'show', 'Show', 'Hall', 'Road', 'Lagos', 'Lagos', now()+interval '10 days', now()+interval '11 days', 'published'),
      ('${otherEventId}', '${outsider}', '${owner}', 'Other', 'other', 'Show', 'Hall', 'Road', 'Lagos', 'Lagos', now()+interval '10 days', now()+interval '11 days', 'published');
    insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total) values
      ('${tier}', '${eventId}', 'General', 100000, 1000), ('${vip}', '${eventId}', 'VIP', 250000, 1000), ('${foreignTier}', '${otherEventId}', 'Other', 100000, 1000);
  `);
  const create = async (
    options: {
      user?: string;
      code?: string;
      type?: string;
      value?: number;
      ids?: string[];
      limit?: number;
      start?: string;
      end?: string;
    } = {},
  ) => {
    return db.query<{ id: string }>(
      `select public.create_organiser_promo_code($1,$2,$3,$4,$5,coalesce($6::timestamptz,now()-interval '1 day'),coalesce($7::timestamptz,now()+interval '1 day'),$8,$9::uuid[]) as id`,
      [
        options.user || owner,
        eventId,
        options.code || 'SAVE20',
        options.type || 'percentage',
        options.value ?? 2000,
        options.start || null,
        options.end || null,
        options.limit ?? 10,
        options.ids || [],
      ],
    );
  };
  const reserve = async (
    code: string | null = 'SAVE20',
    items = [
      { id: tier, quantity: 2 },
      { id: vip, quantity: 1 },
    ],
    event = eventId,
  ) => {
    return db.query<{
      order_id: string;
      subtotal_kobo: number;
      discount_kobo: number;
      fee_kobo: number;
      total_kobo: number;
    }>(
      'select * from public.create_checkout_reservation_v3(null,$1,$2::jsonb,$3::jsonb,$4,$5)',
      [
        event,
        JSON.stringify(
          items.map((item) => ({
            ticket_type_id: item.id,
            quantity: item.quantity,
            attendees: Array.from({ length: item.quantity }, () => ({
              name: 'Ada Guest',
              email: 'ada@example.com',
              phone: '08012345678',
            })),
          })),
        ),
        JSON.stringify({
          name: 'Ada Guest',
          email: 'ada@example.com',
          phone: '08012345678',
        }),
        crypto.randomUUID().replaceAll('-', '') +
          crypto.randomUUID().replaceAll('-', ''),
        code,
      ],
    );
  };
  const rejected = async (
    operation: () => Promise<unknown>,
    pattern: RegExp,
  ) => {
    await db.exec('savepoint rejection');
    await assert.rejects(operation, pattern);
    await db.exec(
      'rollback to savepoint rejection; release savepoint rejection',
    );
  };
  const scenario = async (name: string, run: () => Promise<void>) => {
    await t.test(name, async () => {
      await db.exec('begin');
      try {
        await run();
      } finally {
        await db.exec('rollback');
      }
    });
  };
  try {
    await scenario(
      'only members can create codes and foreign ticket tiers are rejected',
      async () => {
        await rejected(() => create({ user: outsider }), /access unavailable/);
        await rejected(
          () => create({ ids: [foreignTier] }),
          /belonging to this event/,
        );
        await create();
        await rejected(() => create({ code: 'save20' }), /unique constraint/);
      },
    );
    await scenario(
      'anonymous and authenticated roles cannot read codes or invoke trusted RPCs',
      async () => {
        const { rows } = await db.query<{
          readable: boolean;
          callable: boolean;
        }>(
          `select has_table_privilege('anon','public.promo_codes','select') or has_table_privilege('authenticated','public.promo_codes','select') as readable, has_function_privilege('authenticated','public.create_organiser_promo_code(uuid,uuid,text,text,bigint,timestamptz,timestamptz,integer,uuid[])','execute') or has_function_privilege('anon','public.create_checkout_reservation_v3(uuid,uuid,jsonb,jsonb,text,text)','execute') as callable`,
        );
        assert.deepEqual(rows[0], { readable: false, callable: false });
      },
    );
    await scenario(
      'percentage applies only to eligible tiers and recalculates fees',
      async () => {
        await create({ ids: [tier] });
        const {
          rows: [order],
        } = await reserve(' save20 ');
        assert.equal(Number(order.subtotal_kobo), 450000);
        assert.equal(Number(order.discount_kobo), 40000);
        assert.equal(Number(order.fee_kobo), 20500);
        assert.equal(Number(order.total_kobo), 430500);
        const { rows } = await db.query<Record<string, string | number>>(
          'select subtotal_kobo,discount_kobo,fee_kobo,total_kobo from public.orders where id=$1',
          [order.order_id],
        );
        assert.equal(Number(rows[0].total_kobo), 430500);
      },
    );
    await scenario(
      'fixed amounts cap per ticket and fixed fees remain payable',
      async () => {
        await db.exec(
          `insert into public.platform_settings(key,value) values ('platform_fee','{"type":"fixed","fixed_kobo_per_ticket":1000}')`,
        );
        await create({ type: 'fixed', value: 200000 });
        const {
          rows: [order],
        } = await reserve();
        assert.equal(Number(order.discount_kobo), 400000);
        assert.equal(Number(order.fee_kobo), 3000);
        assert.equal(Number(order.total_kobo), 53000);
      },
    );
    await scenario(
      'early bird price is used before applying a code',
      async () => {
        await db.exec(
          `update public.ticket_types set early_bird_price_kobo=80000, early_bird_ends_at=now()+interval '1 day' where id='${tier}'`,
        );
        await create();
        const {
          rows: [order],
        } = await reserve('SAVE20', [{ id: tier, quantity: 1 }]);
        assert.equal(Number(order.subtotal_kobo), 80000);
        assert.equal(Number(order.discount_kobo), 16000);
        assert.equal(Number(order.total_kobo), 67200);
      },
    );
    await scenario(
      'expired, future, disabled, unknown and wrong-event codes are rejected',
      async () => {
        await create({
          code: 'EXPIRED',
          start: '2000-01-01T00:00:00Z',
          end: '2001-01-01T00:00:00Z',
        });
        await create({
          code: 'FUTURE',
          start: '2090-01-01T00:00:00Z',
          end: '2091-01-01T00:00:00Z',
        });
        await create();
        await rejected(() => reserve('EXPIRED'), /has expired/);
        await rejected(() => reserve('FUTURE'), /not valid yet/);
        await rejected(() => reserve('UNKNOWN'), /not available/);
        await rejected(
          () =>
            reserve('SAVE20', [{ id: foreignTier, quantity: 1 }], otherEventId),
          /not available/,
        );
        await db.exec(
          "update public.promo_codes set active=false where code='SAVE20'",
        );
        await rejected(() => reserve(), /not available/);
      },
    );
    await scenario(
      'ineligible carts leave no order, inventory hold or consumed use',
      async () => {
        await create({ ids: [tier] });
        await rejected(
          () => reserve('SAVE20', [{ id: vip, quantity: 1 }]),
          /does not discount/,
        );
        const { rows } = await db.query<Record<string, string | number>>(
          'select (select count(*) from public.orders) as orders, (select sum(quantity_reserved) from public.ticket_types) as held',
        );
        assert.equal(Number(rows[0].orders), 0);
        assert.equal(Number(rows[0].held), 0);
      },
    );
    await scenario(
      'live holds consume the limit and expired holds release it',
      async () => {
        await create({ limit: 1 });
        const {
          rows: [order],
        } = await reserve();
        await rejected(() => reserve(), /usage limit/);
        await db.query<Record<string, string | number>>(
          "update public.orders set reservation_expires_at=now()-interval '1 second' where id=$1",
          [order.order_id],
        );
        await db.query<Record<string, string | number>>(
          "update public.reservations set expires_at=now()-interval '1 second' where order_item_id in (select id from public.order_items where order_id=$1)",
          [order.order_id],
        );
        await reserve();
        const { rows } = await db.query<Record<string, string | number>>(
          'select status from public.orders where id=$1',
          [order.order_id],
        );
        assert.equal(rows[0].status, 'expired');
      },
    );
    await scenario(
      'paid and refunded orders keep their redemption',
      async () => {
        await create({ limit: 1 });
        const {
          rows: [order],
        } = await reserve();
        for (const status of ['paid', 'refunded', 'partially_refunded']) {
          await db.query<Record<string, string | number>>(
            "update public.orders set status=$1, reservation_expires_at=now()-interval '1 day' where id=$2",
            [status, order.order_id],
          );
          await rejected(() => reserve(), /usage limit/);
        }
      },
    );
    await scenario(
      '100 percent discount completes through the existing free booking path',
      async () => {
        await create({ value: 10000 });
        const {
          rows: [order],
        } = await reserve();
        assert.equal(Number(order.total_kobo), 0);
        const result = await db.query<{
          outcome: string;
          ticket_count: number;
        }>(
          'select * from public.complete_free_checkout($1,(select checkout_token_hash from public.orders where id=$1))',
          [order.order_id],
        );
        assert.equal(result.rows[0].outcome, 'success');
        assert.equal(result.rows[0].ticket_count, 3);
      },
    );
    await scenario(
      'discounted amount is passed to payment and verified tickets issue once',
      async () => {
        await create({ limit: 1 });
        const {
          rows: [order],
        } = await reserve();
        const prepared = await db.query<{
          payment_reference: string;
          amount_kobo: number;
        }>(
          'select * from public.prepare_paystack_payment($1,(select checkout_token_hash from public.orders where id=$1))',
          [order.order_id],
        );
        assert.equal(
          Number(prepared.rows[0].amount_kobo),
          Number(order.total_kobo),
        );
        const finalize = () =>
          db.query<{ outcome: string; ticket_count: number }>(
            "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','test-transaction','{}'::jsonb)",
            [prepared.rows[0].payment_reference, order.total_kobo],
          );
        assert.equal((await finalize()).rows[0].outcome, 'success');
        const repeated = await finalize();
        assert.equal(repeated.rows[0].outcome, 'already_paid');
        assert.equal(repeated.rows[0].ticket_count, 3);
        await rejected(() => reserve(), /usage limit/);
      },
    );
    await scenario(
      'validity start is inclusive and end is exclusive',
      async () => {
        await create();
        await db.exec(
          "update public.promo_codes set starts_at=now(),ends_at=now()+interval '1 day'",
        );
        await reserve();
        await db.exec(
          "update public.promo_codes set starts_at=now()-interval '1 day',ends_at=now()",
        );
        await rejected(() => reserve(), /has expired/);
      },
    );
    await scenario(
      'failed inventory validation rolls back the promo reservation',
      async () => {
        await create({ limit: 1 });
        await db.exec(
          `update public.ticket_types set quantity_total=0 where id='${tier}'`,
        );
        await rejected(() => reserve(), /availability/);
        await db.exec(
          `update public.ticket_types set quantity_total=1000 where id='${tier}'`,
        );
        await reserve();
      },
    );
    await scenario(
      'no-code checkout retains existing prices and totals',
      async () => {
        const {
          rows: [order],
        } = await reserve(null);
        assert.equal(Number(order.discount_kobo), 0);
        assert.equal(Number(order.total_kobo), 472500);
      },
    );
  } finally {
    await db.close();
  }
});
