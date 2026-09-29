import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';
const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
void test('automatically records scoped, reconciled settlements exactly once and preserves refund history', async () => {
  const db = await createPromoTestDatabase();
  try {
    for (const name of [
      '202609160002_paystack_split_settlement.sql',
      '202609200006_organiser_payout_tracking.sql',
      '202609290001_automatic_payout_recording.sql',
    ])
      await db.exec(migration(name));
    const owner = '10000000-0000-4000-8000-000000000001',
      other = '10000000-0000-4000-8000-000000000002',
      event = '20000000-0000-4000-8000-000000000001',
      order = '30000000-0000-4000-8000-000000000001';
    await db.exec(`
    insert into auth.users(id) values ('${owner}'),('${other}');
    insert into public.profiles(id,full_name) values ('${owner}','Owner'),('${other}','Other');
    insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Owner','owner','owner@example.com'),('${other}','Other','other','other@example.com');
    insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}'),('${other}','${other}');
    insert into public.categories(id,name,slug) values ('${owner}','Music','music');
    insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at) values ('${event}','${owner}','${owner}','Show','show','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days');
    insert into public.orders(id,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,discount_kobo,fee_kobo,total_kobo) values ('${order}','${event}','paid','Buyer','buyer@example.com','08012345678',repeat('a',64),100000,10000,5000,95000);
    insert into public.payments(order_id,provider_reference,status,amount_kobo,provider_subaccount_code,platform_transaction_charge_kobo,raw_verification) values ('${order}','payment-owner','verified',95000,'ACCT_owner',5000,'{"data":{"domain":"live"}}');
  `);
    const batch = {
      id: '123',
      status: 'pending',
      grossKobo: 90000,
      feesKobo: 2000,
      amountKobo: 88000,
      date: '2026-09-29T00:00:00Z',
      updatedAt: '2026-09-29T09:00:00Z',
    };
    const tx = [{ reference: 'payment-owner', amountKobo: 95000 }];
    const record = (
      organiser = owner,
      code = 'ACCT_owner',
      row = batch,
      transactions = tx,
    ) =>
      db.query('select public.record_paystack_settlement($1,$2,$3,$4) as id', [
        organiser,
        code,
        JSON.stringify(row),
        JSON.stringify(transactions),
      ]);
    const tracking = async (id = owner) =>
      (
        await db.query<{ result: Record<string, unknown> }>(
          'select public.organiser_payout_tracking_v2($1,true) as result',
          [id],
        )
      ).rows[0].result;
    assert.equal(
      (await db.query('select * from public.payout_sync_accounts($1)', [owner]))
        .rows.length,
      1,
    );
    assert.equal(
      (await db.query('select * from public.payout_sync_accounts($1)', [other]))
        .rows.length,
      0,
    );
    const claim = () =>
      db.query<{ ok: boolean }>(
        "select public.claim_payout_sync($1,'ACCT_owner') as ok",
        [owner],
      );
    assert.equal((await claim()).rows[0].ok, true);
    assert.equal((await claim()).rows[0].ok, false);
    await assert.rejects(() => record(other), /reconcile/);
    await assert.rejects(() => record(owner, 'ACCT_wrong'), /reconcile/);
    await assert.rejects(
      () =>
        record(owner, 'ACCT_owner', batch, [{ ...tx[0], amountKobo: 95001 }]),
      /reconcile/,
    );
    await assert.rejects(
      () => record(owner, 'ACCT_owner', batch, [...tx, ...tx]),
      /Duplicate/,
    );
    await record();
    await record();
    assert.equal((await tracking()).paidKobo, 0);
    assert.equal((await tracking()).pendingKobo, 88000);
    const paid = {
      ...batch,
      status: 'paid',
      updatedAt: '2026-09-29T10:00:00Z',
    };
    await record(owner, 'ACCT_owner', paid);
    await record(owner, 'ACCT_owner', paid);
    assert.equal((await tracking()).paidKobo, 88000);
    assert.equal((await tracking()).eligibleKobo, 88000);
    assert.equal((await tracking()).unallocatedKobo, 0);
    assert.equal(((await tracking()).payouts as unknown[]).length, 1);
    assert.equal(((await tracking(other)).payouts as unknown[]).length, 0);
    await record();
    assert.equal((await tracking()).paidKobo, 88000); // stale pending response ignored
    await assert.rejects(
      () => record(owner, 'ACCT_owner', { ...paid, id: '124' }),
      /another payout/,
    );
    await assert.rejects(
      () =>
        record(owner, 'ACCT_owner', {
          ...batch,
          updatedAt: '2026-09-29T11:00:00Z',
        }),
      /downgraded/,
    );
    await db.exec(
      `insert into public.refunds(order_id,requested_by,reason,amount_kobo,status,provider_confirmed_at) values ('${order}','${owner}','Refund',95000,'completed',now()); update public.orders set status='refunded' where id='${order}'; update public.payments set status='refunded' where order_id='${order}';`,
    );
    await record(owner, 'ACCT_owner', paid);
    assert.equal((await tracking()).refundsKobo, 90000);
    assert.equal((await tracking()).paidKobo, 88000);
    const permissions = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','public.record_paystack_settlement(uuid,text,jsonb,jsonb)','execute') as allowed",
    );
    assert.equal(permissions.rows[0].allowed, false);
    await db.exec(
      `update public.payments set raw_verification='{"data":{"domain":"test"}}' where order_id='${order}';`,
    );
    assert.equal((await tracking()).grossSalesKobo, 0);
    await assert.rejects(() => record(owner, 'ACCT_owner', paid), /reconcile/);
  } finally {
    await db.close();
  }
});
