import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

void test('early bird quantity is enforced by existing reservations and payments', async (t) => {
  const db = await createPromoTestDatabase();
  const owner = '10000000-0000-4000-8000-000000000001';
  const event = '20000000-0000-4000-8000-000000000001';
  const tier = '30000000-0000-4000-8000-000000000001';
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
    await db.exec(migration('202609260002_group_tickets.sql'));
    await db.exec(migration('202609260003_group_ticket_claims.sql'));
    await db.exec(migration('202610100001_early_bird_quantity.sql'));
    await db.exec(`
      insert into auth.users values ('${owner}');
      insert into public.profiles(id,full_name) values ('${owner}','Buyer');
      insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Events','events','buyer@example.com');
      insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${owner}','${owner}','Show','show','Events presents','Show','Hall','Road','Lagos','Lagos',now()+interval '2 days',now()+interval '3 days','published');
      insert into public.ticket_types(id,event_id,name,price_kobo,standard_price_kobo,early_bird_price_kobo,early_bird_ends_at,early_bird_quantity,quantity_total)
      values ('${tier}','${event}','General',100000,100000,50000,now()+interval '1 day',2,20);
    `);
    const reserve = async (
      quantity = 1,
      group = false,
      promo: string | null = null,
    ) =>
      (
        await db.query<{
          order_id: string;
          subtotal_kobo: number;
          total_kobo: number;
          discount_kobo: number;
        }>(
          'select * from public.create_checkout_reservation_v3($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
          [
            owner,
            event,
            JSON.stringify([
              {
                ticket_type_id: tier,
                quantity,
                attendees: group
                  ? []
                  : Array.from({ length: quantity }, () => ({
                      name: 'Buyer',
                      email: 'buyer@example.com',
                      phone: '08012345678',
                    })),
              },
            ]),
            JSON.stringify({
              name: 'Buyer',
              email: 'buyer@example.com',
              phone: '08012345678',
            }),
            crypto.randomUUID().replaceAll('-', '') +
              crypto.randomUUID().replaceAll('-', ''),
            promo,
          ],
        )
      ).rows[0];
    const remaining = async () =>
      (
        await db.query<{ remaining: number }>(
          'select public.early_bird_remaining(ticket) as remaining from public.ticket_types as ticket where id=$1',
          [tier],
        )
      ).rows[0].remaining;
    const scenario = async (name: string, run: () => Promise<void>) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await run();
        } finally {
          await db.exec('rollback');
        }
      });
    const reject = async (run: () => Promise<unknown>, error: RegExp) => {
      await db.exec('savepoint rejection');
      await assert.rejects(run, error);
      await db.exec(
        'rollback to savepoint rejection; release savepoint rejection',
      );
    };
    await scenario(
      'reservations consume quota and exhaustion switches to standard pricing',
      async () => {
        assert.equal(await remaining(), 2);
        const a = await reserve();
        assert.equal(Number(a.subtotal_kobo), 50000);
        assert.equal(await remaining(), 1);
        await reject(() => reserve(2), /Only 1 early bird/);
        const b = await reserve();
        assert.equal(Number(b.subtotal_kobo), 50000);
        assert.equal(await remaining(), 0);
        const c = await reserve();
        assert.equal(Number(c.subtotal_kobo), 100000);
        const items = (
          await db.query<{ early_bird_applied: boolean }>(
            'select early_bird_applied from public.order_items where order_id=$1',
            [c.order_id],
          )
        ).rows;
        assert.equal(items[0].early_bird_applied, false);
      },
    );
    await scenario(
      'expired or released holds restore the discounted allocation',
      async () => {
        const a = await reserve(2);
        await db.query(
          "update public.reservations set expires_at=now()-interval '1 minute' where order_item_id in (select id from public.order_items where order_id=$1)",
          [a.order_id],
        );
        assert.equal(await remaining(), 2);
        const b = await reserve(2);
        assert.equal(Number(b.subtotal_kobo), 100000);
        await db.query('select public.release_checkout_order($1)', [
          b.order_id,
        ]);
        assert.equal(await remaining(), 2);
      },
    );
    await scenario(
      'verified payment retains quota and creates individual group admissions',
      async () => {
        await db.query(
          'update public.ticket_types set admissions_per_ticket=5,quantity_total=20 where id=$1',
          [tier],
        );
        const a = await reserve(2, true);
        assert.equal(await remaining(), 0);
        const payment = (
          await db.query<{ payment_reference: string }>(
            'select * from public.prepare_paystack_payment($1,(select checkout_token_hash from public.orders where id=$1))',
            [a.order_id],
          )
        ).rows[0];
        await db.query(
          "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','123456','{}'::jsonb)",
          [payment.payment_reference, a.total_kobo],
        );
        assert.equal(await remaining(), 0);
        const inventory = (
          await db.query<{ quantity_sold: number; quantity_reserved: number }>(
            'select quantity_sold,quantity_reserved from public.ticket_types where id=$1',
            [tier],
          )
        ).rows[0];
        assert.deepEqual(inventory, {
          quantity_sold: 10,
          quantity_reserved: 0,
        });
        assert.equal(
          (await db.query('select * from public.tickets')).rows.length,
          10,
        );
        const b = await reserve(1, true);
        assert.equal(Number(b.subtotal_kobo), 100000);
        await db.query(
          "update public.orders set status='refunded' where id=$1",
          [a.order_id],
        );
        assert.equal(await remaining(), 0);
      },
    );
    await scenario(
      'deadline and promo discounts preserve price and quota snapshots',
      async () => {
        await db.exec(
          `insert into public.promo_codes(event_id,code,discount_type,discount_value,starts_at,ends_at,usage_limit) values ('${event}','TEST10','percentage',1000,now()-interval '1 hour',now()+interval '1 day',10)`,
        );
        const a = await reserve(1, false, 'TEST10');
        assert.equal(Number(a.subtotal_kobo), 50000);
        assert.equal(Number(a.discount_kobo), 5000);
        assert.equal(await remaining(), 1);
        await db.query(
          "update public.ticket_types set early_bird_ends_at=now()-interval '1 minute' where id=$1",
          [tier],
        );
        const b = await reserve();
        assert.equal(Number(b.subtotal_kobo), 100000);
        assert.equal(await remaining(), 1);
      },
    );
    await scenario(
      'organiser save persists the limit and prevents reducing it below existing bookings',
      async () => {
        const booking = await reserve(2);
        const save = async (quantity: number) =>
          db.query(
            `select public.save_organiser_event_v2(
        p_user_id => '${owner}', p_event_id => '${event}', p_organiser_id => '${owner}', p_category_id => '${owner}',
        p_title => 'Show', p_presenter_line => 'Events presents', p_description => 'Show', p_venue_name => 'Hall', p_address => 'Road', p_directions_url => null,
        p_city => 'Lagos', p_state => 'Lagos', p_timezone => 'Africa/Lagos', p_timezone_label => 'WAT',
        p_starts_at => now()+interval '2 days', p_ends_at => now()+interval '3 days', p_sales_start_at => now()-interval '1 day', p_sales_end_at => now()+interval '2 days',
        p_status => 'draft', p_image_path => null, p_organiser_name => 'Events', p_organiser_description => 'Events', p_schedule => '[]'::jsonb, p_policies => '[]'::jsonb, p_ticket_types => $1::jsonb
      )`,
            [
              JSON.stringify([
                {
                  id: tier,
                  name: 'General',
                  price_kobo: 100000,
                  early_bird_price_kobo: 50000,
                  early_bird_ends_at: new Date(
                    Date.now() + 86400000,
                  ).toISOString(),
                  early_bird_quantity: quantity,
                  quantity_total: 20,
                  admissions_per_ticket: 1,
                  min_per_order: 1,
                  max_per_order: 6,
                },
              ]),
            ],
          );
        await reject(() => save(1), /Early bird quantity must cover/);
        await reject(() => save(21), /Early bird quantity must cover/);
        await save(3);
        const saved = (
          await db.query<{ early_bird_quantity: number; price_kobo: number }>(
            'select early_bird_quantity,price_kobo from public.ticket_types where id=$1',
            [tier],
          )
        ).rows[0];
        assert.equal(saved.early_bird_quantity, 3);
        assert.equal(Number(saved.price_kobo), 50000);
        assert.equal(
          (
            await db.query(
              'select * from public.order_items where order_id=$1',
              [booking.order_id],
            )
          ).rows.length,
          1,
        );
      },
    );
    await scenario(
      'public counts do not expose private draft inventory or private quota helpers',
      async () => {
        await db.exec('set role anon');
        try {
          await reject(
            () =>
              db.query('select public.early_bird_packages_used($1)', [tier]),
            /permission denied/,
          );
        } finally {
          await db.exec('reset role');
        }
        await db.query("update public.events set status='draft' where id=$1", [
          event,
        ]);
        assert.equal(await remaining(), null);
      },
    );
  } finally {
    await db.close();
  }
});
