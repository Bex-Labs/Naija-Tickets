import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('entry checks enforce event access, verified payment and one admission', async () => {
  const db = await createPromoTestDatabase();
  const owner = '10000000-0000-4000-8000-000000000001';
  const staff = '10000000-0000-4000-8000-000000000002';
  const outsider = '10000000-0000-4000-8000-000000000003';
  const organiser = '20000000-0000-4000-8000-000000000001';
  const category = '30000000-0000-4000-8000-000000000001';
  const event = '40000000-0000-4000-8000-000000000001';
  const otherEvent = '40000000-0000-4000-8000-000000000002';
  const order = '50000000-0000-4000-8000-000000000001';
  const tier = '60000000-0000-4000-8000-000000000001';
  const item = '70000000-0000-4000-8000-000000000001';
  const ticket = '80000000-0000-4000-8000-000000000001';
  const code = 'NT-123456ABCDEF';
  async function verify(
    user = staff,
    admit = false,
    selectedEvent = event,
    selectedCode = code,
  ) {
    const { rows } = await db.query<{
      result: {
        outcome: string;
        admitted: boolean;
        admissionsUsed: number;
        attendeeName?: string;
        checkedInAt?: string;
      };
    }>(
      'select public.verify_event_entry($1::uuid,$2::uuid,$3::text,$4::boolean) as result',
      [user, selectedEvent, selectedCode, admit],
    );
    return rows[0].result;
  }
  try {
    await db.exec(
      'alter table auth.users add column email text, add column email_confirmed_at timestamptz;',
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609230004_event_entry.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.exec(`
      insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.com',now()),('${staff}','staff@example.com',now()),('${outsider}','other@example.com',now());
      insert into public.profiles(id,full_name) values ('${owner}','Owner'),('${staff}','Staff'),('${outsider}','Other');
      insert into public.organisers(id,name,slug,contact_email) values ('${organiser}','Events','events','owner@example.com');
      insert into public.organiser_memberships(organiser_id,user_id,title) values ('${organiser}','${owner}','Owner');
      insert into public.categories(id,name,slug) values ('${category}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${organiser}','${category}','Lagos Live','lagos-live','Show','Hall','Road','Lagos','Lagos',now(),now()+interval '1 day','published'),
             ('${otherEvent}','${organiser}','${category}','Other Show','other-show','Show','Hall','Road','Lagos','Lagos',now(),now()+interval '1 day','published');
      insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total) values ('${tier}','${event}','General admission',0,10);
      insert into public.orders(id,customer_id,event_id,status,subtotal_kobo,discount_kobo,fee_kobo,total_kobo,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash)
      values ('${order}',null,'${event}','paid',0,0,0,0,'Guest','guest@example.com','08012345678',repeat('a',64));
      insert into public.order_items(id,order_id,ticket_type_id,quantity,unit_price_kobo,line_total_kobo) values ('${item}','${order}','${tier}',1,0,0);
      insert into public.payments(order_id,provider,provider_reference,status,amount_kobo) values ('${order}','demo_free','free-test','verified',0);
      insert into public.tickets(id,order_item_id,event_id,attendee_name,attendee_email,qr_token_hash,display_code,status,attendee_index)
      values ('${ticket}','${item}','${event}','Guest Name','guest@example.com',repeat('b',64),'${code}','valid',0);
    `);
    await assert.rejects(() => verify(), /not assigned/);
    await assert.rejects(
      () =>
        db.query('select public.assign_event_entry_staff($1,$2,$3)', [
          outsider,
          event,
          'staff@example.com',
        ]),
      /Organiser access/,
    );
    await db.query('select public.assign_event_entry_staff($1,$2,$3)', [
      owner,
      event,
      ' STAFF@example.com ',
    ]);
    await db.query('select public.assign_event_entry_staff($1,$2,$3)', [
      owner,
      event,
      'staff@example.com',
    ]);
    assert.equal((await verify()).outcome, 'valid');
    assert.equal((await verify(owner)).outcome, 'valid');
    assert.equal(
      (await verify(staff, false, event, 'not a ticket')).outcome,
      'invalid',
    );
    assert.equal(
      (await verify(staff, false, event, 'NT-AAAAAAAAAAAA')).attendeeName,
      undefined,
    );
    assert.equal((await verify(owner, false, otherEvent)).outcome, 'invalid');
    await assert.rejects(() => verify(outsider), /not assigned/);
    assert.equal(
      (
        await db.query<{ count: number }>(
          'select count(*)::integer as count from public.check_ins',
        )
      ).rows[0].count,
      0,
    );

    for (const status of ['cancelled', 'refunded']) {
      await db.query('update public.tickets set status=$1 where id=$2', [
        status,
        ticket,
      ]);
      assert.equal((await verify(staff, true)).outcome, status);
    }
    await db.exec(
      `update public.tickets set status='valid'; update public.orders set status='pending';`,
    );
    assert.equal((await verify(staff, true)).outcome, 'unpaid');
    await db.exec(
      `update public.orders set status='paid'; update public.payments set status='failed';`,
    );
    assert.equal((await verify(staff, true)).outcome, 'unpaid');
    await db.exec(
      `update public.payments set status='verified'; update public.events set status='cancelled' where id='${event}';`,
    );
    assert.equal((await verify(staff, true)).outcome, 'event_unavailable');
    await db.exec(
      `update public.events set status='published' where id='${event}';`,
    );
    const results = await Promise.all([
      verify(staff, true),
      verify(owner, true),
    ]);
    assert.deepEqual(results.map((result) => result.outcome).sort(), [
      'admitted',
      'already_used',
    ]);
    const admitted = results.find((result) => result.admitted)!;
    assert.equal(admitted.admissionsUsed, 1);
    assert.equal(admitted.attendeeName, 'Guest Name');
    assert.ok(admitted.checkedInAt);
    assert.equal((await verify()).outcome, 'already_used');
    assert.equal(
      (await db.query<{ status: string }>('select status from public.tickets'))
        .rows[0].status,
      'used',
    );
    // Even if another process restores the ticket status, the admission record prevents re-entry.
    await db.exec(`update public.tickets set status='valid';`);
    assert.equal((await verify(staff, true)).outcome, 'already_used');
    assert.equal(
      (
        await db.query<{ count: number }>(
          'select count(*)::integer as count from public.check_ins',
        )
      ).rows[0].count,
      1,
    );
    await db.exec('delete from public.event_staff_assignments');
    await assert.rejects(() => verify(), /not assigned/);
    await db.exec(
      `update auth.users set email_confirmed_at=null where id='${staff}';`,
    );
    await assert.rejects(
      () =>
        db.query('select public.assign_event_entry_staff($1,$2,$3)', [
          owner,
          event,
          'staff@example.com',
        ]),
      /confirm an account/,
    );
    await db.exec('set role authenticated');
    await assert.rejects(() => verify(owner, true), /permission denied/);
    await assert.rejects(
      () =>
        db.query('select public.assign_event_entry_staff($1,$2,$3)', [
          owner,
          event,
          'staff@example.com',
        ]),
      /permission denied/,
    );
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});
