import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

void test('group tickets extend existing checkout, payments, inventory and entry', async (t) => {
  const db = await createPromoTestDatabase();
  const owner = '10000000-0000-4000-8000-000000000001';
  const event = '20000000-0000-4000-8000-000000000001';
  const group = '30000000-0000-4000-8000-000000000001';
  const single = '30000000-0000-4000-8000-000000000002';
  const free = '30000000-0000-4000-8000-000000000003';
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
    await db.exec(
      `alter table public.organisers add column account_type text not null default 'organisation';`,
    );
    await db.exec(migration('202609200007_organiser_verification.sql'));
    await db.exec(migration('202609230001_unverified_organiser_limits.sql'));
    await db.exec(migration('202609260002_group_tickets.sql'));
    const entry = migration('202609230004_event_entry.sql');
    await db.exec(
      entry.slice(
        0,
        entry.indexOf('create function public.assign_event_entry_staff'),
      ),
    );
    await db.exec(migration('202609250001_admin_refunds.sql'));
    await db.exec(`
      insert into auth.users values ('${owner}');
      insert into public.profiles(id,full_name) values ('${owner}','Buyer');
      insert into public.organisers(id,name,slug,contact_email,verified_at) values ('${owner}','Events','events','buyer@example.com',now());
      insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${owner}','${owner}','Group Show','group-show','Events presents','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','published');
      insert into public.ticket_types(id,event_id,name,description,price_kobo,quantity_total,admissions_per_ticket) values
      ('${group}','${event}','Squad Pass','Admits five people',4500000,20,5),
      ('${single}','${event}','Individual',null,100000,10,1),
      ('${free}','${event}','Free Group',null,0,10,5);
    `);
    const reserve = async (
      lines = [{ id: group, quantity: 2, size: 5 }],
      code: string | null = null,
    ) => {
      const {
        rows: [order],
      } = await db.query<{
        order_id: string;
        subtotal_kobo: number;
        total_kobo: number;
        discount_kobo: number;
      }>(
        'select * from public.create_checkout_reservation_v3($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
        [
          owner,
          event,
          JSON.stringify(
            lines.map((line) => ({
              ticket_type_id: line.id,
              quantity: line.quantity,
              attendees: Array.from(
                { length: line.quantity * line.size },
                (_, i) => ({
                  name: `Guest ${i + 1}`,
                  email: `guest${i + 1}@example.com`,
                  phone: '08012345678',
                }),
              ),
            })),
          ),
          JSON.stringify({
            name: 'Buyer Name',
            email: 'buyer@example.com',
            phone: '08012345678',
          }),
          crypto.randomUUID().replaceAll('-', '') +
            crypto.randomUUID().replaceAll('-', ''),
          code,
        ],
      );
      return order;
    };
    const pay = async (order: { order_id: string; total_kobo: number }) => {
      const {
        rows: [payment],
      } = await db.query<{ payment_reference: string; amount_kobo: number }>(
        'select * from public.prepare_paystack_payment($1,(select checkout_token_hash from public.orders where id=$1))',
        [order.order_id],
      );
      assert.equal(Number(payment.amount_kobo), Number(order.total_kobo));
      const finalize = () =>
        db.query<{ outcome: string; ticket_count: number }>(
          "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','123456','{}'::jsonb)",
          [payment.payment_reference, order.total_kobo],
        );
      const result = await finalize();
      assert.equal(result.rows[0].outcome, 'success');
      return { result: result.rows[0], finalize };
    };
    const inventory = async (id = group) =>
      (
        await db.query<{
          quantity_total: number;
          quantity_sold: number;
          quantity_reserved: number;
        }>(
          'select quantity_total,quantity_sold,quantity_reserved from public.ticket_types where id=$1',
          [id],
        )
      ).rows[0];
    const reject = async (
      operation: () => Promise<unknown>,
      pattern: RegExp,
    ) => {
      await db.exec('savepoint rejection');
      await assert.rejects(operation, pattern);
      await db.exec(
        'rollback to savepoint rejection; release savepoint rejection',
      );
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

    await scenario(
      'two packages reserve ten admissions and payment issues ten unique, independently usable tickets once',
      async () => {
        const order = await reserve();
        assert.equal(Number(order.subtotal_kobo), 9000000);
        assert.equal((await inventory()).quantity_reserved, 10);
        assert.equal(
          (await db.query('select * from public.tickets')).rows.length,
          0,
        );
        const item = (
          await db.query<{ quantity: number; admissions_per_ticket: number }>(
            'select quantity,admissions_per_ticket from public.order_items where order_id=$1',
            [order.order_id],
          )
        ).rows[0];
        assert.deepEqual(item, { quantity: 2, admissions_per_ticket: 5 });
        const { result, finalize } = await pay(order);
        assert.equal(result.ticket_count, 10);
        const tickets = (
          await db.query<{ display_code: string; qr_token_hash: string }>(
            'select display_code,qr_token_hash from public.tickets order by attendee_index',
          )
        ).rows;
        assert.equal(
          new Set(tickets.map((ticket) => ticket.display_code)).size,
          10,
        );
        assert.equal(
          new Set(tickets.map((ticket) => ticket.qr_token_hash)).size,
          10,
        );
        assert.deepEqual(await inventory(), {
          quantity_total: 20,
          quantity_sold: 10,
          quantity_reserved: 0,
        });
        assert.equal((await finalize()).rows[0].outcome, 'already_paid');
        assert.equal(
          (await db.query('select * from public.tickets')).rows.length,
          10,
        );
        const scan = async (code: string) =>
          (
            await db.query<{ result: { outcome: string } }>(
              'select public.verify_event_entry($1,$2,$3,true) as result',
              [owner, event, code],
            )
          ).rows[0].result;
        assert.equal((await scan(tickets[0].display_code)).outcome, 'admitted');
        assert.equal(
          (await scan(tickets[0].display_code)).outcome,
          'already_used',
        );
        assert.equal((await scan(tickets[1].display_code)).outcome, 'admitted');
      },
    );
    await scenario(
      'full refunds invalidate every individual admission in a group',
      async () => {
        const order = await reserve();
        await pay(order);
        await db.query(
          "select public.record_admin_refund($1,'98765','123456',$2,'NGN','processed','Event cancelled','admin-test')",
          [order.order_id, order.total_kobo],
        );
        const {
          rows: [counts],
        } = await db.query<{ refunded: number; valid: number }>(
          "select count(*) filter(where status='refunded')::integer as refunded,count(*) filter(where status='valid')::integer as valid from public.tickets",
        );
        assert.deepEqual(counts, { refunded: 10, valid: 0 });
      },
    );
    await scenario(
      'insufficient admission capacity and incomplete attendees roll back all holds',
      async () => {
        await reserve([{ id: group, quantity: 3, size: 5 }]);
        await reject(() => reserve(), /availability/);
        await reject(
          () => reserve([{ id: group, quantity: 1, size: 1 }]),
          /Attendee details/,
        );
        assert.equal((await inventory()).quantity_reserved, 15);
        assert.equal(
          (await db.query('select * from public.orders')).rows.length,
          1,
        );
      },
    );
    await scenario(
      'released and expired group holds return all admissions to inventory',
      async () => {
        const order = await reserve();
        await db.query('select public.release_checkout_order($1)', [
          order.order_id,
        ]);
        assert.equal((await inventory()).quantity_reserved, 0);
        const held = await reserve();
        await db.query(
          "update public.reservations set expires_at=now()-interval '1 minute' where order_item_id in (select id from public.order_items where order_id=$1)",
          [held.order_id],
        );
        await reserve();
        assert.equal((await inventory()).quantity_reserved, 10);
      },
    );
    await scenario(
      'mixed ordinary and group tickets retain existing prices and capacities',
      async () => {
        const order = await reserve([
          { id: group, quantity: 1, size: 5 },
          { id: single, quantity: 2, size: 1 },
        ]);
        assert.equal(Number(order.subtotal_kobo), 4700000);
        assert.equal((await pay(order)).result.ticket_count, 7);
        assert.equal((await inventory()).quantity_sold, 5);
        assert.equal((await inventory(single)).quantity_sold, 2);
      },
    );
    await scenario(
      'free group bookings and promo discounts reuse existing payment paths',
      async () => {
        await db.query(
          "select public.create_organiser_promo_code($1,$2,'SQUAD20','percentage',2000,now()-interval '1 day',now()+interval '1 day',10,array[]::uuid[])",
          [owner, event],
        );
        const discounted = await reserve(undefined, 'SQUAD20');
        assert.equal(Number(discounted.discount_kobo), 1800000);
        assert.equal((await pay(discounted)).result.ticket_count, 10);
        const zero = await reserve([{ id: free, quantity: 1, size: 5 }]);
        const {
          rows: [completed],
        } = await db.query<{ outcome: string; ticket_count: number }>(
          'select * from public.complete_free_checkout($1,(select checkout_token_hash from public.orders where id=$1))',
          [zero.order_id],
        );
        assert.equal(completed.outcome, 'success');
        assert.equal(completed.ticket_count, 5);
      },
    );
    await scenario(
      'organiser saves group ticket settings through the existing editor RPC',
      async () => {
        const ticket = {
          name: 'Group of five',
          description: 'Friends enter separately',
          price_kobo: 4500000,
          quantity_total: 15,
          admissions_per_ticket: 5,
          min_per_order: 1,
          max_per_order: 6,
          active: true,
        };
        const {
          rows: [saved],
        } = await db.query<{ id: string }>(
          `select public.save_organiser_event_v2($1,null,$1,$1,'Group Event','Events presents','A group event','Hall','Road',null,'Lagos','Lagos','Africa/Lagos','WAT',now()+interval '1 day',now()+interval '2 days',now()-interval '1 day',now()+interval '1 day','draft',null,'Events','About Events','[]'::jsonb,'[]'::jsonb,$2::jsonb) as id`,
          [owner, JSON.stringify([ticket])],
        );
        const {
          rows: [tier],
        } = await db.query<{
          admissions_per_ticket: number;
          quantity_total: number;
          standard_price_kobo: number;
        }>(
          'select admissions_per_ticket,quantity_total,standard_price_kobo from public.ticket_types where event_id=$1',
          [saved.id],
        );
        assert.equal(tier.admissions_per_ticket, 5);
        assert.equal(tier.quantity_total, 15);
        assert.equal(Number(tier.standard_price_kobo), 4500000);
        await reserve();
        await reject(
          () =>
            db.query(
              'update public.ticket_types set admissions_per_ticket=4 where id=$1',
              [group],
            ),
          /cannot change after/,
        );
      },
    );
    await scenario(
      'unverified organiser limits count people rather than packages',
      async () => {
        await db.exec(`insert into public.organisers(id,name,slug,contact_email) values ('40000000-0000-4000-8000-000000000001','Unverified','unverified','unverified@example.com');
        insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at,status)
        values ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','${owner}','Free Show','free-show','Free Events presents','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','draft');
        insert into public.ticket_types(event_id,name,price_kobo,quantity_total,admissions_per_ticket)
        values ('50000000-0000-4000-8000-000000000001','Group',0,100,5);
        set constraints all immediate;`);
        await reject(
          () =>
            db.exec(
              "update public.ticket_types set quantity_total=105 where event_id='50000000-0000-4000-8000-000000000001'",
            ),
          /maximum of 100 tickets/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
