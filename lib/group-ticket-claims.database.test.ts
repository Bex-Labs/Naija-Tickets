import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

void test('group claims reuse verified payments and admission inventory', async (t) => {
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
    await db.exec(migration('202609260003_group_ticket_claims.sql'));
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
              attendees:
                line.size > 1
                  ? []
                  : Array.from(
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

    const claim = async (
      token: string,
      index: number,
      phone?: string,
      email?: string,
    ) =>
      (
        await db.query<{ token: string }>(
          'select public.claim_group_ticket($1,$2,$3,$4) as token',
          [
            token,
            `Guest ${index}`,
            email || `guest${index}@example.com`,
            phone || `08012345${String(index).padStart(3, '0')}`,
          ],
        )
      ).rows[0].token;
    const booking = async () =>
      (
        await db.query<{
          id: string;
          invite_token: string;
          admissions: number;
        }>('select * from public.group_bookings')
      ).rows[0];
    const slots = async () =>
      (
        await db.query<{
          id: string;
          claim_state: string;
          display_code: string | null;
          qr_token_hash: string | null;
          claim_access_token: string | null;
        }>(
          'select id,claim_state,display_code,qr_token_hash,claim_access_token from public.tickets order by attendee_index',
        )
      ).rows;
    const scan = async (code: string | null) =>
      (
        await db.query<{ result: { outcome: string } }>(
          'select public.verify_event_entry($1,$2,$3,true) as result',
          [owner, event, code],
        )
      ).rows[0].result;
    await scenario(
      'verified payment creates ten sold slots without QR codes; repeated verification creates no duplicates',
      async () => {
        const order = await reserve();
        assert.equal((await inventory()).quantity_reserved, 10);
        assert.equal((await slots()).length, 0);
        assert.equal(
          (await db.query('select * from public.group_bookings')).rows.length,
          0,
        );
        const { finalize } = await pay(order);
        assert.equal((await booking()).admissions, 10);
        assert.match((await booking()).invite_token, /^[a-f0-9]{64}$/);
        assert.equal((await slots()).length, 10);
        assert.ok(
          (await slots()).every(
            (slot) =>
              slot.claim_state === 'UNCLAIMED' &&
              slot.display_code === null &&
              slot.qr_token_hash === null,
          ),
        );
        assert.deepEqual(await inventory(), {
          quantity_total: 20,
          quantity_sold: 10,
          quantity_reserved: 0,
        });
        assert.equal((await scan(null)).outcome, 'invalid');
        await finalize();
        assert.equal((await slots()).length, 10);
        // Converted paid reservations cannot expire or release sold admissions.
        await db.query('select public.release_checkout_order($1)', [
          order.order_id,
        ]);
        assert.equal((await inventory()).quantity_sold, 10);
      },
    );
    await scenario(
      'claiming generates independent QR codes and single-use check-ins without changing sold capacity',
      async () => {
        await pay(await reserve());
        const groupBooking = await booking();
        const receipt = await claim(groupBooking.invite_token, 1);
        assert.match(receipt, /^[a-f0-9]{64}$/);
        let tickets = await slots();
        assert.equal(
          tickets.filter((ticket) => ticket.claim_state === 'CLAIMED').length,
          1,
        );
        assert.equal(tickets[0].claim_access_token, receipt);
        assert.match(tickets[0].display_code || '', /^NT-[A-F0-9]{12}$/);
        await claim(groupBooking.invite_token, 2);
        tickets = await slots();
        assert.notEqual(tickets[0].display_code, tickets[1].display_code);
        assert.notEqual(tickets[0].qr_token_hash, tickets[1].qr_token_hash);
        assert.equal((await scan(tickets[0].display_code)).outcome, 'admitted');
        assert.equal(
          (await scan(tickets[0].display_code)).outcome,
          'already_used',
        );
        assert.equal((await scan(tickets[1].display_code)).outcome, 'admitted');
        assert.equal((await slots())[0].claim_state, 'CHECKED_IN');
        assert.equal((await inventory()).quantity_sold, 10);
      },
    );
    await scenario(
      'duplicate email and normalised phone are rejected within a group',
      async () => {
        await pay(await reserve());
        const token = (await booking()).invite_token;
        await claim(token, 1);
        await reject(
          () => claim(token, 2, undefined, ' GUEST1@EXAMPLE.COM '),
          /already claimed/,
        );
        await reject(
          () => claim(token, 2, '+234 801 234 5001'),
          /already claimed/,
        );
        await reject(
          () => claim(token, 2, '002348012345001'),
          /already claimed/,
        );
        assert.equal(
          (await slots()).filter((slot) => slot.claim_state === 'CLAIMED')
            .length,
          1,
        );
      },
    );
    await scenario('concurrent submissions stop at the last slot', async () => {
      await pay(await reserve([{ id: group, quantity: 1, size: 5 }]));
      const token = (await booking()).invite_token;
      for (let i = 1; i < 5; i++) await claim(token, i);
      // Separate submissions are queued by embedded PostgreSQL. The booking lock
      // and unique indexes enforce the same decision for concurrent connections.
      await db.exec(`create function public.try_group_claim(token text, guest integer) returns text language plpgsql as $$
        begin return public.claim_group_ticket(token,'Guest '||guest,'guest'||guest||'@example.com','08012345'||lpad(guest::text,3,'0'));
        exception when others then return null; end; $$;`);
      const results = await Promise.all(
        [5, 6].map((guest) =>
          db.query<{ receipt: string | null }>(
            'select public.try_group_claim($1,$2) as receipt',
            [token, guest],
          ),
        ),
      );
      assert.equal(
        results.filter((result) => result.rows[0].receipt).length,
        1,
      );
      assert.equal(
        results.filter((result) => !result.rows[0].receipt).length,
        1,
      );
      assert.equal(
        (await slots()).filter((slot) => slot.claim_state === 'CLAIMED').length,
        5,
      );
      await reject(() => claim(token, 7), /All tickets/);
    });
    await scenario(
      'full refunds revoke claimed QR codes and prevent remaining claims',
      async () => {
        const order = await reserve();
        await pay(order);
        const token = (await booking()).invite_token;
        await claim(token, 1);
        const code = (await slots())[0].display_code;
        await db.query(
          "select public.record_admin_refund($1,'98765','123456',$2,'NGN','processed','Event cancelled','admin-test')",
          [order.order_id, order.total_kobo],
        );
        assert.equal((await scan(code)).outcome, 'refunded');
        await reject(() => claim(token, 2), /unavailable/);
        assert.equal(
          (
            await db.query<{ n: number }>(
              "select count(*)::integer as n from public.tickets where status='refunded'",
            )
          ).rows[0].n,
          10,
        );
      },
    );
    await scenario(
      'expired or cancelled events and invalid invite tokens reject claims',
      async () => {
        await pay(await reserve());
        const token = (await booking()).invite_token;
        await reject(() => claim('0'.repeat(64), 1), /unavailable/);
        await db.query(
          "update public.events set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id=$1",
          [event],
        );
        await reject(() => claim(token, 1), /unavailable/);
      },
    );
    await scenario(
      'mixed checkout and free groups preserve ordinary ticket issuance and pricing',
      async () => {
        const order = await reserve([
          { id: group, quantity: 1, size: 5 },
          { id: single, quantity: 2, size: 1 },
        ]);
        assert.equal(Number(order.subtotal_kobo), 4700000);
        assert.equal((await pay(order)).result.ticket_count, 7);
        assert.equal(
          (await slots()).filter((slot) => slot.display_code).length,
          2,
        );
        const zero = await reserve([{ id: free, quantity: 1, size: 5 }]);
        await db.query(
          'select * from public.complete_free_checkout($1,(select checkout_token_hash from public.orders where id=$1))',
          [zero.order_id],
        );
        assert.equal((await slots()).length, 12);
        assert.equal(
          (await db.query('select * from public.group_bookings')).rows.length,
          2,
        );
      },
    );
    await scenario(
      'pending group bookings from before this migration still issue their registered attendees',
      async () => {
        const order = await reserve([{ id: group, quantity: 1, size: 5 }]);
        await db.query(
          'update public.order_items set group_claim_required=false,attendee_data=$2::jsonb where order_id=$1',
          [
            order.order_id,
            JSON.stringify(
              Array.from({ length: 5 }, (_, i) => ({
                name: `Legacy ${i}`,
                email: `legacy${i}@example.com`,
                phone: '08012345678',
              })),
            ),
          ],
        );
        await pay(order);
        assert.equal(
          (await slots()).filter((slot) => slot.display_code).length,
          5,
        );
        assert.equal(
          (await db.query('select * from public.group_bookings')).rows.length,
          0,
        );
      },
    );
    await scenario(
      'claim functions and group tokens are not directly available to anonymous or unrelated accounts',
      async () => {
        await pay(await reserve());
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege('anon','public.claim_group_ticket(text,text,text,text)','execute') as allowed",
            )
          ).rows[0].allowed,
          false,
        );
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_table_privilege('authenticated','public.group_bookings','select') as allowed",
            )
          ).rows[0].allowed,
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});
