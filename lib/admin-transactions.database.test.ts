import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AdminTransactionsPage } from './admin-transactions.ts';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('admin transactions use verified payment records and restrict access', async (t) => {
  const db = await createPromoTestDatabase();
  try {
    // The test helper loads payment migrations but not the guest privacy migration.
    await db.exec(
      'alter table public.orders add column personal_data_erased_at timestamptz',
    );
    await db.exec(
      'alter default privileges in schema public grant execute on functions to anon, authenticated',
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609240001_admin_transactions.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );

    const owner = '10000000-0000-4000-8000-000000000001';
    const event = '20000000-0000-4000-8000-000000000001';
    await db.exec(`
      insert into auth.users values ('${owner}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner');
      insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Owner','owner','owner@example.com');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${owner}','${owner}','Lagos Jazz','lagos-jazz','Show','Hall','Road','Lagos','Lagos',now()+interval '10 days',now()+interval '11 days','published');
    `);

    const add = async (
      index: number,
      orderStatus: string,
      paymentStatus: string | null,
      provider = 'paystack',
      erased = false,
    ) => {
      const id = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const ref = `NT-TEST-${index}`;
      await db.query(
        `insert into public.orders(id,reference,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,discount_kobo,fee_kobo,total_kobo,personal_data_erased_at)
         values ($1,$2,$3,$4,'Ada Buyer','ada@example.com','08012345678',$5,10000,0,500,10500,$6)`,
        [
          id,
          ref,
          event,
          orderStatus,
          index.toString(16).padStart(64, '0'),
          erased ? new Date() : null,
        ],
      );
      if (paymentStatus) {
        await db.query(
          `insert into public.payments(order_id,provider,provider_reference,status,amount_kobo,raw_verification,verified_at)
           values ($1,$2,$3,$4,10500,$5,$6)`,
          [
            id,
            provider,
            `pay-${index}`,
            paymentStatus,
            provider === 'paystack' ? { data: { channel: 'card' } } : null,
            paymentStatus === 'verified' ? new Date() : null,
          ],
        );
      }
      return id;
    };

    await add(1, 'paid', 'verified');
    await add(2, 'paid', 'pending');
    await add(3, 'pending', 'failed');
    await add(4, 'paid', 'verified', 'demo_free');
    await add(5, 'refunded', 'refunded');
    await add(6, 'pending', 'verified');
    await add(7, 'paid', 'verified', 'paystack', true);
    await add(8, 'pending', null);

    const get = async (
      search = '',
      status = 'all',
      method = 'all',
      page = 1,
    ) => {
      const { rows } = await db.query<{
        admin_transactions: AdminTransactionsPage;
      }>('select public.admin_transactions($1,$2,$3,$4)', [
        search,
        status,
        method,
        page,
      ]);
      return rows[0].admin_transactions;
    };

    await t.test(
      'statuses, payment methods and redaction follow the records',
      async () => {
        const result = await get();
        assert.equal(result.total, 8);
        const byRef = Object.fromEntries(
          result.transactions.map((row) => [row.reference, row]),
        );
        assert.equal(byRef['NT-TEST-1'].status, 'verified');
        assert.equal(byRef['NT-TEST-1'].paymentMethod, 'card');
        assert.equal(byRef['NT-TEST-2'].status, 'needs_review');
        assert.equal(byRef['NT-TEST-3'].status, 'failed');
        assert.equal(byRef['NT-TEST-4'].status, 'verified');
        assert.equal(byRef['NT-TEST-4'].paymentMethod, 'Free booking');
        assert.equal(byRef['NT-TEST-5'].status, 'refunded');
        assert.equal(byRef['NT-TEST-6'].status, 'needs_review');
        assert.equal(
          byRef['NT-TEST-7'].customerName,
          'Guest buyer (details erased)',
        );
        assert.equal(byRef['NT-TEST-7'].customerEmail, null);
        assert.equal(byRef['NT-TEST-8'].paymentStatus, 'not_started');
      },
    );

    await t.test(
      'search, filters and pagination operate on all orders',
      async () => {
        assert.equal((await get('Lagos Jazz', 'needs_review')).total, 2);
        assert.deepEqual(
          (await get('NT-TEST-4')).transactions.map((row) => row.reference),
          ['NT-TEST-4'],
        );
        assert.equal((await get('', 'verified', 'demo_free')).total, 1);
        assert.equal((await get('', 'verified', 'paystack')).total, 2);
        assert.equal((await get('', 'all', 'all', 2)).transactions.length, 0);
        assert.equal((await get('%')).total, 0); // Wildcards are literal search text.
      },
    );

    await t.test('only the service role can execute the function', async () => {
      const { rows } = await db.query<{
        anon: boolean;
        authenticated: boolean;
        service: boolean;
      }>(
        "select has_function_privilege('anon','public.admin_transactions(text,text,text,integer)','execute') as anon, has_function_privilege('authenticated','public.admin_transactions(text,text,text,integer)','execute') as authenticated, has_function_privilege('service_role','public.admin_transactions(text,text,text,integer)','execute') as service",
      );
      assert.deepEqual(rows[0], {
        anon: false,
        authenticated: false,
        service: true,
      });
    });
  } finally {
    await db.close();
  }
});
