import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

void test('purchase and event notifications stay scoped to their recipients', async () => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(migration('202609230002_customer_saved_events.sql'));
    await db.exec(migration('202609230003_customer_notifications.sql'));
    const customer = '10000000-0000-4000-8000-000000000001';
    const other = '10000000-0000-4000-8000-000000000002';
    const organiser = '20000000-0000-4000-8000-000000000001';
    const category = '30000000-0000-4000-8000-000000000001';
    const event = '40000000-0000-4000-8000-000000000001';
    const order = '50000000-0000-4000-8000-000000000001';
    const guestOrder = '50000000-0000-4000-8000-000000000002';
    await db.exec(`
      insert into auth.users(id) values ('${customer}'), ('${other}');
      insert into public.profiles(id,full_name) values ('${customer}','Customer'), ('${other}','Other Customer');
      insert into public.organisers(id,name,slug,contact_email) values ('${organiser}','Events','events','events@example.com');
      insert into public.categories(id,name,slug) values ('${category}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${organiser}','${category}','Lagos Live','lagos-live','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','published');
      insert into public.saved_events(user_id,event_id) values ('${customer}','${event}');
      insert into public.orders(
        id,customer_id,event_id,status,subtotal_kobo,discount_kobo,fee_kobo,total_kobo,
        purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash
      ) values (
        '${order}','${customer}','${event}','pending',0,0,0,0,
        'Customer','customer@example.com','08012345678',repeat('a',64)
      );
      update public.orders set status='paid',paid_at=now() where id='${order}';
      insert into public.orders(
        id,customer_id,event_id,status,subtotal_kobo,discount_kobo,fee_kobo,total_kobo,
        purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash
      ) values (
        '${guestOrder}',null,'${event}','pending',0,0,0,0,
        'Guest Customer','guest@example.com','08012345678',repeat('b',64)
      );
      update public.orders set status='paid',paid_at=now() where id='${guestOrder}';
      update public.events set status='submitted',updated_at=now() where id='${event}';
      update public.events set status='published',updated_at=now() where id='${event}';
    `);

    const { rows } = await db.query<{
      user_id: string;
      notification_type: string;
      link_path: string | null;
    }>(`
      select user_id,notification_type,link_path
      from public.customer_notifications order by created_at,id
    `);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((notification) => notification.user_id === customer));
    assert.deepEqual(
      rows.map((notification) => notification.notification_type).sort(),
      ['event_available', 'event_unavailable', 'purchase_confirmed'],
    );
    assert.ok(
      rows.some(
        (notification) =>
          notification.notification_type === 'purchase_confirmed' &&
          notification.link_path?.includes('/payment/status?reference='),
      ),
    );
    const {
      rows: [otherCount],
    } = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.customer_notifications where user_id='${other}'`,
    );
    assert.equal(otherCount.count, 0);
  } finally {
    await db.close();
  }
});
