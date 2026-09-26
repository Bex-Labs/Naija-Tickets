import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('past events disappear publicly but remain in admin and purchase history; checkout cannot bypass expiry', async () => {
  const db = await createPromoTestDatabase();
  const owner = '10000000-0000-4000-8000-000000000001';
  const admin = '10000000-0000-4000-8000-000000000002';
  const buyer = '10000000-0000-4000-8000-000000000003';
  const past = '20000000-0000-4000-8000-000000000001';
  const future = '20000000-0000-4000-8000-000000000002';
  const tier = '30000000-0000-4000-8000-000000000001';
  try {
    for (const name of [
      '202609230002_customer_saved_events.sql',
      '202609260001_past_event_visibility.sql',
    ]) {
      await db.exec(
        readFileSync(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          'utf8',
        ),
      );
    }
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('test.user_id', true), '')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated;
      grant select on public.events, public.orders to anon, authenticated;
      insert into auth.users values ('${owner}'), ('${admin}'), ('${buyer}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner'),('${admin}','Admin'),('${buyer}','Buyer');
      insert into public.user_roles(user_id,role) values ('${admin}','administrator');
      insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Events','events','owner@example.com');
      insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${past}','${owner}','${owner}','Past','past','Show','Hall','Road','Lagos','Lagos',now()-interval '2 days',now()+interval '1 day','published'),
        ('${future}','${owner}','${owner}','Future','future','Show','Hall','Road','Lagos','Lagos',now()+interval '2 days',now()+interval '3 days','published');
      insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total) values ('${tier}','${past}','General',100000,100);
      insert into public.orders(customer_id,event_id,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash) values ('${buyer}','${past}','Ada Guest','ada@example.com','08012345678',repeat('b',64));
      update public.events set ends_at=now()-interval '1 day' where id='${past}';
    `);
    const visible = async (role: string, user = '') => {
      await db.query("select set_config('test.user_id',$1,false)", [user]);
      await db.exec(`set role ${role}`);
      try {
        return (
          await db.query<{ id: string }>(
            'select id from public.events order by id',
          )
        ).rows.map((row) => row.id);
      } finally {
        await db.exec('reset role');
      }
    };
    assert.deepEqual(await visible('anon'), [future]);
    assert.deepEqual(await visible('authenticated', buyer), [future]);
    assert.deepEqual(await visible('authenticated', owner), [past, future]);
    assert.deepEqual(await visible('authenticated', admin), [past, future]);
    await db.query("select set_config('test.user_id',$1,false)", [buyer]);
    await db.exec('set role authenticated');
    assert.equal(
      (await db.query('select * from public.orders')).rows.length,
      1,
    );
    await db.exec('reset role');
    await assert.rejects(
      db.query(
        "insert into public.orders(customer_id,event_id,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash) values ($1,$2,'Ada Guest','ada@example.com','08012345678',repeat('c',64))",
        [buyer, past],
      ),
      /not available for checkout/,
    );
    await assert.rejects(
      db.query(
        'select * from public.create_checkout_reservation_v3($1,$2,$3::jsonb,$4::jsonb,$5,null)',
        [
          buyer,
          past,
          JSON.stringify([
            {
              ticket_type_id: tier,
              quantity: 1,
              attendees: [
                {
                  name: 'Ada Guest',
                  email: 'ada@example.com',
                  phone: '08012345678',
                },
              ],
            },
          ]),
          JSON.stringify({
            name: 'Ada Guest',
            email: 'ada@example.com',
            phone: '08012345678',
          }),
          'a'.repeat(64),
        ],
      ),
      /not available for checkout/,
    );
    const {
      rows: [ticket],
    } = await db.query<{ quantity_reserved: number }>(
      'select quantity_reserved from public.ticket_types where id=$1',
      [tier],
    );
    assert.equal(ticket.quantity_reserved, 0);
    assert.equal(
      (await db.query('select * from public.orders')).rows.length,
      1,
    );
    await db.query(
      "insert into public.orders(customer_id,event_id,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash) values ($1,$2,'Ada Guest','ada@example.com','08012345678',repeat('c',64))",
      [buyer, future],
    );
    await db.exec(
      `update public.orders set status='expired' where event_id='${past}'`,
    );
    assert.equal(
      (await db.query('select * from public.orders')).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
