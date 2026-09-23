import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

void test('unverified organiser limits are enforced in PostgreSQL', async () => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(
      `alter table public.organisers add column account_type text not null default 'organisation';`,
    );
    await db.exec(migration('202609200007_organiser_verification.sql'));
    await db.exec(migration('202609230001_unverified_organiser_limits.sql'));

    const owner = '10000000-0000-4000-8000-000000000001';
    const secondAdmin = '10000000-0000-4000-8000-000000000002';
    const organiser = '20000000-0000-4000-8000-000000000001';
    const category = '30000000-0000-4000-8000-000000000001';
    const firstEvent = '40000000-0000-4000-8000-000000000001';
    const secondEvent = '40000000-0000-4000-8000-000000000002';
    await db.exec(`
      insert into auth.users(id) values ('${owner}'), ('${secondAdmin}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner'), ('${secondAdmin}','Second Admin');
      insert into public.organisers(id,name,slug,contact_email) values ('${organiser}','Free Events','free-events','owner@example.com');
      insert into public.organiser_memberships(organiser_id,user_id,title) values ('${organiser}','${owner}','Owner');
      insert into public.categories(id,name,slug) values ('${category}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${firstEvent}','${organiser}','${category}','First','first','Free event','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','submitted');
      insert into public.ticket_types(event_id,name,price_kobo,quantity_total)
      values ('${firstEvent}','General admission',0,100);
      update public.events set status='published' where id='${firstEvent}';
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${secondEvent}','${organiser}','${category}','Second','second','Free event','Hall','Road','Lagos','Lagos',now()+interval '3 days',now()+interval '4 days','draft');
    `);

    await assert.rejects(
      db.exec(`
        insert into public.events(organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
        values ('${organiser}','${category}','Third','third','Third event','Hall','Road','Lagos','Lagos',now()+interval '5 days',now()+interval '6 days','draft');
      `),
      /maximum of 2 active events/,
    );
    await assert.rejects(
      db.exec(
        `insert into public.organiser_memberships(organiser_id,user_id,title) values ('${organiser}','${secondAdmin}','Admin')`,
      ),
      /only 1 administrator/,
    );
    await assert.rejects(
      db.exec(
        `insert into public.ticket_types(event_id,name,price_kobo,quantity_total) values ('${secondEvent}','Paid',1000,10)`,
      ),
      /free tickets only/,
    );
    await assert.rejects(
      db.exec(
        `insert into public.ticket_types(event_id,name,price_kobo,quantity_total) values ('${secondEvent}','Too many',0,101)`,
      ),
      /maximum of 100 tickets/,
    );
    await assert.rejects(
      db.exec(
        `update public.events set featured=true where id='${firstEvent}'`,
      ),
      /Only verified organiser events can be featured/,
    );
    await assert.rejects(
      db.query(
        `select public.create_organiser_promo_code($1,$2,'FREE10','percentage',1000,now(),now()+interval '1 day',10,array[]::uuid[])`,
        [owner, firstEvent],
      ),
      /Verify your organiser account to create promo codes/,
    );

    await db.query(
      `select public.submit_organiser_verification($1,$2,'Free Events Limited','RC 1234567')`,
      [owner, organiser],
    );
    await db.query(
      `select public.review_organiser_verification($1,true,'Approved','admin')`,
      [organiser],
    );
    await db.exec(
      `insert into public.organiser_memberships(organiser_id,user_id,title) values ('${organiser}','${secondAdmin}','Admin')`,
    );
    await db.exec(
      `update public.events set featured=true where id='${firstEvent}'`,
    );
    await db.query(
      `select public.create_organiser_promo_code($1,$2,'SAVE10','percentage',1000,now(),now()+interval '1 day',10,array[]::uuid[])`,
      [owner, firstEvent],
    );

    const {
      rows: [result],
    } = await db.query<{ members: number; featured: boolean }>(`
      select
        (select count(*)::integer from public.organiser_memberships where organiser_id='${organiser}') as members,
        (select featured from public.events where id='${firstEvent}') as featured
    `);
    assert.deepEqual(result, { members: 2, featured: true });

    await db.query(
      `select public.review_organiser_verification($1,false,'Verification revoked','admin')`,
      [organiser],
    );
    const {
      rows: [restricted],
    } = await db.query<{
      members: number;
      featured: boolean;
      promo_active: boolean;
      status: string;
    }>(`
      select
        (select count(*)::integer from public.organiser_memberships where organiser_id='${organiser}') as members,
        (select featured from public.events where id='${firstEvent}') as featured,
        (select active from public.promo_codes where event_id='${firstEvent}' and code='SAVE10') as promo_active,
        (select status::text from public.events where id='${firstEvent}') as status
    `);
    assert.deepEqual(restricted, {
      members: 1,
      featured: false,
      promo_active: false,
      status: 'published',
    });
  } finally {
    await db.close();
  }
});
