import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('admin refunds reconcile verified Paystack records and ticket entry', async (t) => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(
      'alter default privileges in schema public grant execute on functions to anon, authenticated',
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609250001_admin_refunds.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const owner = '10000000-0000-4000-8000-000000000001';
    const event = '20000000-0000-4000-8000-000000000001';
    const tier = '30000000-0000-4000-8000-000000000001';
    const order = '40000000-0000-4000-8000-000000000001';
    const item = '50000000-0000-4000-8000-000000000001';
    await db.exec(`
      insert into auth.users values ('${owner}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner');
      insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Owner','owner','owner@example.com');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values ('${event}','${owner}','${owner}','Lagos Jazz','lagos-jazz','Show','Hall','Road','Lagos','Lagos',now()+interval '10 days',now()+interval '11 days','published');
      insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total,quantity_sold)
      values ('${tier}','${event}','General',5000,20,2);
      insert into public.orders(id,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,discount_kobo,fee_kobo,total_kobo)
      values ('${order}','${event}','paid','Ada','ada@example.com','08012345678',repeat('a',64),10000,0,500,10500);
      insert into public.order_items(id,order_id,ticket_type_id,quantity,unit_price_kobo,line_total_kobo)
      values ('${item}','${order}','${tier}',2,5000,10000);
      insert into public.tickets(order_item_id,event_id,attendee_index,attendee_name,attendee_email,qr_token_hash,display_code,status)
      values ('${item}','${event}',0,'Ada','ada@example.com','qr-1','NT-000000000001','valid'),
        ('${item}','${event}',1,'Bee','bee@example.com','qr-2','NT-000000000002','valid');
      insert into public.payments(order_id,provider,provider_reference,provider_transaction_id,status,amount_kobo)
      values ('${order}','paystack','NT-payment-1','7654321','verified',10500);
    `);

    const record = async (
      refundId: string,
      amount: number,
      providerStatus: string,
      transactionId = '7654321',
      reason = 'Customer request',
    ) => {
      const { rows } = await db.query<{ value: Record<string, unknown> }>(
        'select public.record_admin_refund($1,$2,$3,$4,$5,$6,$7,$8) as value',
        [
          order,
          refundId,
          transactionId,
          amount,
          'NGN',
          providerStatus,
          reason,
          'primary',
        ],
      );
      return rows[0].value;
    };
    const summary = async () => {
      const { rows } = await db.query<{
        value: Array<Record<string, unknown>>;
      }>('select public.admin_refund_summaries($1::uuid[]) as value', [
        [order],
      ]);
      return rows[0].value[0];
    };
    const orderState = async () => {
      const { rows } = await db.query<{
        order_status: string;
        payment_status: string;
        ticket_statuses: string[];
      }>(
        `select o.status::text as order_status, p.status::text as payment_status,
          array(select t.status from public.tickets t join public.order_items i on i.id = t.order_item_id where i.order_id = o.id order by t.display_code) as ticket_statuses
         from public.orders o join public.payments p on p.order_id = o.id where o.id = $1`,
        [order],
      );
      return rows[0];
    };

    await t.test(
      'a refund must match the verified payment and available amount',
      async () => {
        await assert.rejects(record('1001', 4000, 'processed', 'wrong-id'));
        await assert.rejects(record('1001', 11000, 'processed'));
        await assert.rejects(record('1001', 4000, 'processed', '7654321', 'x'));
        assert.deepEqual(await orderState(), {
          order_status: 'paid',
          payment_status: 'verified',
          ticket_statuses: ['valid', 'valid'],
        });
      },
    );

    await t.test(
      'a failed provider refund does not reduce eligibility or invalidate tickets',
      async () => {
        const result = await record('999', 2000, 'failed');
        assert.equal(result.status, 'failed');
        assert.equal((await summary()).canRecordRefund, true);
        assert.deepEqual(await orderState(), {
          order_status: 'paid',
          payment_status: 'verified',
          ticket_statuses: ['valid', 'valid'],
        });
      },
    );

    await t.test(
      'processing reserves the amount and does not invalidate tickets',
      async () => {
        const result = await record('1001', 4000, 'processing');
        assert.equal(result.status, 'processing');
        const values = await summary();
        assert.equal(values.refundedKobo, 0);
        assert.equal(values.processingKobo, 4000);
        assert.equal(values.remainingKobo, 6500);
        assert.equal(values.canRecordRefund, false);
        await assert.rejects(record('1002', 6500, 'processed'));
        assert.deepEqual(await orderState(), {
          order_status: 'paid',
          payment_status: 'verified',
          ticket_statuses: ['valid', 'valid'],
        });
      },
    );

    await t.test(
      'confirmed partial refund is idempotent and keeps tickets valid',
      async () => {
        const result = await record('1001', 4000, 'processed', '7654321', '');
        assert.equal(result.status, 'completed');
        await record('1001', 4000, 'processed', '7654321', '');
        const { rows } = await db.query<{ count: number }>(
          'select count(*)::integer as count from public.refunds',
        );
        assert.equal(rows[0].count, 2);
        assert.equal((await summary()).canRecordRefund, true);
        assert.deepEqual(await orderState(), {
          order_status: 'partially_refunded',
          payment_status: 'verified',
          ticket_statuses: ['valid', 'valid'],
        });
      },
    );

    await t.test(
      'a fully confirmed refund closes the order and all valid tickets',
      async () => {
        const result = await record('1002', 6500, 'processed');
        assert.equal(result.refundedKobo, 10500);
        assert.deepEqual(await orderState(), {
          order_status: 'refunded',
          payment_status: 'refunded',
          ticket_statuses: ['refunded', 'refunded'],
        });
        assert.equal((await summary()).canRecordRefund, false);
        await assert.rejects(record('1003', 100, 'processed'));
      },
    );

    await t.test(
      'only the service role can use private refund functions',
      async () => {
        const { rows } = await db.query<{
          anon: boolean;
          authenticated: boolean;
          service: boolean;
          summariesAnon: boolean;
          summariesAuthenticated: boolean;
          summariesService: boolean;
        }>(
          "select has_function_privilege('anon','public.record_admin_refund(uuid,text,text,bigint,text,text,text,text)','execute') as anon, has_function_privilege('authenticated','public.record_admin_refund(uuid,text,text,bigint,text,text,text,text)','execute') as authenticated, has_function_privilege('service_role','public.record_admin_refund(uuid,text,text,bigint,text,text,text,text)','execute') as service, has_function_privilege('anon','public.admin_refund_summaries(uuid[])','execute') as \"summariesAnon\", has_function_privilege('authenticated','public.admin_refund_summaries(uuid[])','execute') as \"summariesAuthenticated\", has_function_privilege('service_role','public.admin_refund_summaries(uuid[])','execute') as \"summariesService\"",
        );
        assert.deepEqual(rows[0], {
          anon: false,
          authenticated: false,
          service: true,
          summariesAnon: false,
          summariesAuthenticated: false,
          summariesService: true,
        });
      },
    );
  } finally {
    await db.close();
  }
});
