import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { OrganiserPayoutTracking } from './organiser-payouts.ts';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('payout tracking reconciles verified sales and scopes organiser records', async () => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(
      `alter default privileges in schema public grant execute on functions to anon, authenticated;`,
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200006_organiser_payout_tracking.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const owner = '10000000-0000-4000-8000-000000000001';
    const other = '10000000-0000-4000-8000-000000000002';
    const event = '20000000-0000-4000-8000-000000000001';
    const otherEvent = '20000000-0000-4000-8000-000000000002';
    const order = '30000000-0000-4000-8000-000000000001';
    const otherOrder = '30000000-0000-4000-8000-000000000002';
    await db.exec(`
      insert into auth.users(id) values ('${owner}'), ('${other}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner'), ('${other}','Other');
      insert into public.organisers(id,name,slug,contact_email) values
        ('${owner}','Owner','owner','owner@example.com'), ('${other}','Other','other','other@example.com');
      insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}'), ('${other}','${other}');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at) values
        ('${event}','${owner}','${owner}','Owner event','owner-event','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days'),
        ('${otherEvent}','${other}','${owner}','Other event','other-event','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days');
      insert into public.orders(id,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,discount_kobo,fee_kobo,total_kobo) values
        ('${order}','${event}','partially_refunded','Guest','guest@example.com','08012345678',repeat('a',64),100000,10000,5000,95000),
        ('${otherOrder}','${otherEvent}','paid','Guest','guest@example.com','08012345678',repeat('b',64),200000,0,10000,210000);
      insert into public.payments(order_id,provider_reference,status,amount_kobo) values
        ('${order}','pay-owner','verified',95000), ('${otherOrder}','pay-other','verified',210000);
      insert into public.refunds(order_id,requested_by,reason,amount_kobo,status,provider_confirmed_at) values
        ('${order}','${owner}','Partial',20000,'completed',now());
      insert into public.payouts(organiser_id,period_start,period_end,gross_kobo,fees_kobo,refunds_kobo,net_kobo,status,paid_at,scheduled_at) values
        ('${owner}','2026-09-01','2026-09-10',40000,2000,0,38000,'paid',now(),null),
        ('${owner}','2026-09-11','2026-09-20',10000,1000,0,9000,'pending',null,null),
        ('${owner}','2026-09-11','2026-09-20',10000,0,0,10000,'approved',null,now()+interval '1 day'),
        ('${other}','2026-09-01','2026-09-20',200000,0,0,200000,'paid',now(),null);
    `);
    const {
      rows: [{ result }],
    } = await db.query<{ result: OrganiserPayoutTracking }>(
      'select public.organiser_payout_tracking($1) as result',
      [owner],
    );
    assert.equal(result.grossSalesKobo, 100000);
    assert.equal(result.discountsKobo, 10000);
    assert.equal(result.refundsKobo, 20000);
    assert.equal(result.payoutFeesKobo, 3000);
    assert.equal(result.eligibleKobo, 67000);
    assert.equal(result.paidKobo, 38000);
    assert.equal(result.pendingKobo, 9000);
    assert.equal(result.scheduledKobo, 10000);
    assert.equal(result.unallocatedKobo, 10000);
    assert.equal(result.payouts.length, 3);
    assert.ok(
      result.payouts.every(
        (payout) =>
          payout.organiserName === 'Owner' &&
          payout.reference.startsWith('PO-'),
      ),
    );
    const {
      rows: [{ result: outsider }],
    } = await db.query<{ result: OrganiserPayoutTracking }>(
      'select public.organiser_payout_tracking($1) as result',
      [other],
    );
    assert.equal(outsider.grossSalesKobo, 200000);
    assert.equal(outsider.payouts.length, 1);
    const {
      rows: [{ result: unknown }],
    } = await db.query<{ result: OrganiserPayoutTracking }>(
      'select public.organiser_payout_tracking($1) as result',
      ['10000000-0000-4000-8000-000000000099'],
    );
    assert.equal(unknown.eligibleKobo, 0);
    assert.deepEqual(unknown.payouts, []);
    const {
      rows: [permissions],
    } = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      select has_function_privilege('anon','public.organiser_payout_tracking(uuid)','execute') as anon,
        has_function_privilege('authenticated','public.organiser_payout_tracking(uuid)','execute') as authenticated,
        has_function_privilege('service_role','public.organiser_payout_tracking(uuid)','execute') as service
    `);
    assert.deepEqual(permissions, {
      anon: false,
      authenticated: false,
      service: true,
    });
    await assert.rejects(
      db.exec(
        `insert into public.payouts(organiser_id,period_start,period_end,gross_kobo,fees_kobo,refunds_kobo,net_kobo,status) values ('${owner}','2026-09-01','2026-09-02',100,20,0,100,'pending')`,
      ),
    );
  } finally {
    await db.close();
  }
});
