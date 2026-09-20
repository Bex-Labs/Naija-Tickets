import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';
import { validIdentityReference } from './organiser-verification.ts';

void test('verification is private and gates new publication', async () => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(
      `alter table public.organisers add column account_type text not null default 'organisation';`,
    );
    await db.exec(
      `alter default privileges in schema public grant execute on functions to anon, authenticated;`,
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200007_organiser_verification.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200008_verification_identity_and_alerts.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const owner = '10000000-0000-4000-8000-000000000001';
    const other = '10000000-0000-4000-8000-000000000002';
    const event = '20000000-0000-4000-8000-000000000001';
    await db.exec(`
      insert into auth.users(id) values ('${owner}'), ('${other}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner'), ('${other}','Other');
      insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Owner Events','owner','owner@example.com');
      insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status) values
        ('${event}','${owner}','${owner}','Event','event','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','submitted');
    `);
    await assert.rejects(
      db.query('select public.submit_organiser_verification($1,$2,$3,$4)', [
        other,
        owner,
        'Fake Owner',
        'CAC-123',
      ]),
    );
    await assert.rejects(
      db.exec(
        `update public.events set status='published' where id='${event}'`,
      ),
    );
    await db.query('select public.submit_organiser_verification($1,$2,$3,$4)', [
      owner,
      owner,
      'Owner Legal',
      'CAC-123',
    ]);
    const {
      rows: [pending],
    } = await db.query<{ status: string }>(
      `select status from public.organiser_verification_requests where organiser_id='${owner}'`,
    );
    assert.equal(pending.status, 'pending');
    await assert.rejects(
      db.query('select public.review_organiser_verification($1,$2,$3,$4)', [
        owner,
        false,
        '',
        'admin',
      ]),
    );
    await db.query('select public.review_organiser_verification($1,$2,$3,$4)', [
      owner,
      true,
      'Reference reviewed',
      'admin',
    ]);
    const {
      rows: [verified],
    } = await db.query<{ verified_at: string | null }>(
      `select verified_at from public.organisers where id='${owner}'`,
    );
    assert.ok(verified.verified_at);
    const {
      rows: [unread],
    } = await db.query<{ decision_seen_at: string | null }>(
      `select decision_seen_at from public.organiser_verification_requests where organiser_id='${owner}'`,
    );
    assert.equal(unread.decision_seen_at, null);
    await db.exec(
      `update public.organiser_verification_requests set decision_seen_at=now() where organiser_id='${owner}'`,
    );
    await db.exec(
      `update public.events set status='published' where id='${event}'`,
    );
    await db.query('select public.review_organiser_verification($1,$2,$3,$4)', [
      owner,
      false,
      'Identity mismatch',
      'admin',
    ]);
    const {
      rows: [revoked],
    } = await db.query<{ verified_at: string | null }>(
      `select verified_at from public.organisers where id='${owner}'`,
    );
    assert.equal(revoked.verified_at, null);
    const {
      rows: [revocationUnread],
    } = await db.query<{ decision_seen_at: string | null }>(
      `select decision_seen_at from public.organiser_verification_requests where organiser_id='${owner}'`,
    );
    assert.equal(revocationUnread.decision_seen_at, null);
    await db.query('select public.submit_organiser_verification($1,$2,$3,$4)', [
      owner,
      owner,
      'Owner Legal',
      'CAC-123',
    ]);
    await db.query('select public.review_organiser_verification($1,$2,$3,$4)', [
      owner,
      true,
      'Rechecked',
      'admin',
    ]);
    await db.exec(
      `update public.organisers set name='New Owner Events' where id='${owner}'`,
    );
    const {
      rows: [invalidated],
    } = await db.query<{ verified_at: string | null; status: string }>(
      `select o.verified_at,r.status from public.organisers o join public.organiser_verification_requests r on r.organiser_id=o.id where o.id='${owner}'`,
    );
    assert.equal(invalidated.verified_at, null);
    assert.equal(invalidated.status, 'unverified');
    await db.exec(
      `insert into public.organisers(id,name,slug,contact_email,account_type) values ('${other}','Solo Organiser','solo','solo@example.com','individual')`,
    );
    await db.exec(
      `insert into public.organiser_memberships(organiser_id,user_id) values ('${other}','${other}')`,
    );
    await assert.rejects(
      db.query('select public.submit_organiser_verification($1,$2,$3,$4)', [
        other,
        other,
        'Solo Person',
        '1234567890',
      ]),
    );
    await db.query('select public.submit_organiser_verification($1,$2,$3,$4)', [
      other,
      other,
      'Solo Person',
      '12345678901',
    ]);
    assert.equal(validIdentityReference('individual', '12345678901'), true);
    assert.equal(validIdentityReference('individual', '1234567890a'), false);
    assert.equal(validIdentityReference('organisation', 'RC 1234567'), true);
    await db.exec(
      `update public.events set status='submitted' where id='${event}'`,
    );
    await assert.rejects(
      db.exec(
        `update public.events set status='published' where id='${event}'`,
      ),
    );
    const {
      rows: [permissions],
    } = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
      table_access: boolean;
    }>(`
      select has_function_privilege('anon','public.review_organiser_verification(uuid,boolean,text,text)','execute') as anon,
        has_function_privilege('authenticated','public.submit_organiser_verification(uuid,uuid,text,text)','execute') as authenticated,
        has_function_privilege('service_role','public.review_organiser_verification(uuid,boolean,text,text)','execute') as service,
        has_table_privilege('authenticated','public.organiser_verification_requests','select') as table_access
    `);
    assert.deepEqual(permissions, {
      anon: false,
      authenticated: false,
      service: true,
      table_access: false,
    });
  } finally {
    await db.close();
  }
});
