import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';
const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
void test('ticket emails require verified payment, exclude cancelled tickets and safely retry once', async () => {
  const db = await createPromoTestDatabase();
  try {
    for (const name of [
      '202609150002_event_detail_editor.sql',
      '202609150004_guest_privacy_and_ticket_email.sql',
      '202609290002_verified_ticket_emails.sql',
    ])
      await db.exec(migration(name));
    const owner = '10000000-0000-4000-8000-000000000001',
      event = '20000000-0000-4000-8000-000000000001',
      order = '30000000-0000-4000-8000-000000000001';
    await db.exec(`
    insert into auth.users(id) values ('${owner}');
    insert into public.profiles(id,full_name) values ('${owner}','Buyer');
    insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Events','events','events@example.com');
    insert into public.categories(id,name,slug) values ('${owner}','Music','music');
    insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at) values ('${event}','${owner}','${owner}','Show','show','Events presents','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days');
    insert into public.orders(id,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,fee_kobo,total_kobo,paid_at) values ('${order}','${event}','paid','Buyer','buyer@example.com','08012345678',repeat('a',64),100000,5000,105000,now());
    insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total) values ('${owner}','${event}','Regular',100000,10);
    insert into public.order_items(id,order_id,ticket_type_id,quantity,unit_price_kobo,line_total_kobo) values ('${owner}','${order}','${owner}',1,100000,100000);
    insert into public.tickets(order_item_id,event_id,attendee_name,attendee_email,qr_token_hash,display_code,attendee_index,status) values ('${owner}','${event}','Buyer','buyer@example.com',repeat('b',64),'NT-VALID',0,'valid'),('${owner}','${event}','Cancelled','cancelled@example.com',repeat('c',64),'NT-CANCELLED',1,'cancelled');
  `);
    type Claim = {
      outcome: string;
      delivery_id: string;
      total_kobo: number;
      currency: string;
      recipient_email: string;
      tickets: { display_code: string }[];
    };
    const claim = async () =>
      (
        await db.query<{ result: Claim }>(
          'select public.claim_ticket_delivery_v3($1) as result',
          [order],
        )
      ).rows[0].result;
    assert.equal((await claim()).outcome, 'not_ready');
    assert.equal(
      (await db.query('select * from public.ticket_deliveries')).rows.length,
      0,
    );
    await db.exec(
      `insert into public.payments(order_id,provider_reference,status,amount_kobo) values ('${order}','payment-fixture','verified',105000);`,
    );
    const first = await claim();
    assert.equal(first.outcome, 'send');
    assert.equal(first.recipient_email, 'buyer@example.com');
    assert.equal(first.total_kobo, 105000);
    assert.equal(first.currency, 'NGN');
    assert.deepEqual(
      first.tickets.map((t) => t.display_code),
      ['NT-VALID'],
    );
    assert.equal((await claim()).outcome, 'in_progress');
    await db.query(
      "select public.complete_ticket_delivery($1,false,null,'temporary failure')",
      [first.delivery_id],
    );
    assert.equal((await claim()).outcome, 'retry_later');
    await db.exec(
      "update public.ticket_deliveries set claimed_at=now()-interval '2 minutes'",
    );
    assert.equal((await claim()).outcome, 'send');
    await db.query(
      "select public.complete_ticket_delivery($1,true,'email-fixture',null)",
      [first.delivery_id],
    );
    assert.equal((await claim()).outcome, 'already_sent');
    for (const state of ['failed', 'pending', 'refunded']) {
      await db.query('update public.orders set status=$1 where id=$2', [
        state,
        order,
      ]);
      assert.equal((await claim()).outcome, 'not_ready');
    }
    await db.exec(
      `update public.orders set status='paid',personal_data_erased_at=now() where id='${order}';`,
    );
    assert.equal((await claim()).outcome, 'suppressed');
    const permission = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','public.claim_ticket_delivery_v3(uuid)','execute') as allowed",
    );
    assert.equal(permission.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});
