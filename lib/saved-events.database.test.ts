import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('saved events belong to customers and disappear with deleted events', async () => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609230002_customer_saved_events.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const user = '10000000-0000-4000-8000-000000000001';
    const organiser = '20000000-0000-4000-8000-000000000001';
    const category = '30000000-0000-4000-8000-000000000001';
    const event = '40000000-0000-4000-8000-000000000001';
    await db.exec(`
      insert into auth.users(id) values ('${user}');
      insert into public.profiles(id,full_name) values ('${user}','Customer');
      insert into public.organisers(id,name,slug,contact_email) values ('${organiser}','Events','events','events@example.com');
      insert into public.categories(id,name,slug) values ('${category}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${organiser}','${category}','Saved show','saved-show','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','published');
      insert into public.saved_events(user_id,event_id) values ('${user}','${event}');
      update public.events set status='submitted' where id='${event}';
    `);
    const {
      rows: [saved],
    } = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.saved_events where user_id='${user}'`,
    );
    assert.equal(saved.count, 1);

    await db.exec(`delete from public.events where id='${event}'`);
    const {
      rows: [removed],
    } = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.saved_events where user_id='${user}'`,
    );
    assert.equal(removed.count, 0);

    const {
      rows: [permissions],
    } = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select
        has_table_privilege('anon','public.saved_events','select') as anon,
        has_table_privilege('authenticated','public.saved_events','select') as authenticated
    `);
    assert.deepEqual(permissions, { anon: false, authenticated: true });
  } finally {
    await db.close();
  }
});
