import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AdminSalesAnalytics } from './admin-analytics.ts';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('admin analytics aggregates verified platform sales without exposing purchaser data', async (t) => {
  const db = await createPromoTestDatabase();
  try {
    // Match Supabase's explicit API-role default grants before migration.
    await db.exec(
      'alter default privileges in schema public grant execute on functions to anon, authenticated',
    );
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200005_admin_sales_analytics.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const orgA = '10000000-0000-4000-8000-000000000001';
    const orgB = '10000000-0000-4000-8000-000000000002';
    const concert = '20000000-0000-4000-8000-000000000001';
    const festival = '20000000-0000-4000-8000-000000000002';
    const tierA = '30000000-0000-4000-8000-000000000001';
    const tierB = '30000000-0000-4000-8000-000000000002';
    await db.exec(`
      insert into auth.users values ('${orgA}'), ('${orgB}');
      insert into public.profiles(id,full_name) values ('${orgA}','Owner A'), ('${orgB}','Owner B');
      insert into public.organisers(id,name,slug,contact_email) values ('${orgA}','Owner A','owner-a','a@example.com'), ('${orgB}','Owner B','owner-b','b@example.com');
      insert into public.categories(id,name,slug) values ('${orgA}','Concert','concert'), ('${orgB}','Festival','festival');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status) values
        ('${concert}','${orgA}','${orgA}','Concert A','concert-a','Show','Hall','Road','Lagos','Lagos',now()+interval '10 days',now()+interval '11 days','published'),
        ('${festival}','${orgB}','${orgB}','Festival B','festival-b','Show','Hall','Road','Lagos','Lagos',now()+interval '12 days',now()+interval '13 days','published');
      insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total,quantity_sold,quantity_reserved,active) values
        ('${tierA}','${concert}','General',100000,10,2,2,true),
        ('${tierB}','${festival}','Admission',50000,8,1,0,true);
    `);
    const addOrder = async (
      index: number,
      eventId: string,
      tierId: string,
      status: string,
      paymentStatus: string,
      quantity: number,
      subtotal: number,
      discount: number,
      fee: number,
    ) => {
      const orderId = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const itemId = `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await db.query(
        `insert into public.orders(id,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,discount_kobo,fee_kobo,total_kobo) values ($1,$2,$3,'Ada Guest','ada@example.com','08012345678',$4,$5,$6,$7,$8)`,
        [
          orderId,
          eventId,
          status,
          index.toString(16).padStart(64, '0'),
          subtotal,
          discount,
          fee,
          subtotal - discount + fee,
        ],
      );
      await db.query(
        `insert into public.order_items(id,order_id,ticket_type_id,quantity,unit_price_kobo,line_total_kobo,attendee_data) values ($1,$2,$3,$4,$5,$6,'[]'::jsonb)`,
        [itemId, orderId, tierId, quantity, subtotal / quantity, subtotal],
      );
      await db.query(
        `insert into public.payments(order_id,provider,provider_reference,status,amount_kobo) values ($1,'paystack',$2,$3,$4)`,
        [orderId, `payment-${index}`, paymentStatus, subtotal - discount + fee],
      );
      for (let i = 0; i < quantity; i++) {
        await db.query(
          `insert into public.tickets(order_item_id,event_id,attendee_index,attendee_name,attendee_email,qr_token_hash,display_code,status) values ($1,$2,$3,'Ada Guest','ada@example.com',$4,$5,'valid')`,
          [itemId, eventId, i, `qr-${index}-${i}`, `NT-${index}-${i}`],
        );
      }
      return orderId;
    };
    await addOrder(
      1,
      concert,
      tierA,
      'paid',
      'verified',
      2,
      200000,
      20000,
      9000,
    );
    const partial = await addOrder(
      2,
      festival,
      tierB,
      'partially_refunded',
      'verified',
      1,
      50000,
      0,
      2500,
    );
    await db.query(
      `insert into public.refunds(order_id,requested_by,reason,amount_kobo,status,provider_confirmed_at) values ($1,$2,'Partial',10000,'completed',now())`,
      [partial, orgB],
    );
    await addOrder(3, concert, tierA, 'paid', 'pending', 1, 100000, 0, 5000);
    await addOrder(
      4,
      festival,
      tierB,
      'pending',
      'verified',
      1,
      50000,
      0,
      2500,
    );
    await addOrder(
      5,
      concert,
      tierA,
      'refunded',
      'verified',
      1,
      100000,
      0,
      5000,
    );
    await db.exec(`insert into public.reservations(order_item_id,ticket_type_id,quantity,expires_at) values
      ('50000000-0000-4000-8000-000000000004','${tierB}',1,now()+interval '10 minutes'),
      ('50000000-0000-4000-8000-000000000003','${tierA}',1,now()-interval '1 minute');`);

    await t.test(
      'totals and categories include only verified, non-refunded sales',
      async () => {
        const { rows } = await db.query<{
          admin_sales_analytics: AdminSalesAnalytics;
        }>('select public.admin_sales_analytics()');
        const result = rows[0].admin_sales_analytics;
        assert.deepEqual(
          {
            events: result.eventCount,
            bookings: result.bookings,
            tickets: result.ticketsSold,
            revenue: result.ticketRevenueKobo,
            fees: result.serviceFeesKobo,
            remaining: result.inventoryRemaining,
            held: result.inventoryReserved,
          },
          {
            events: 2,
            bookings: 2,
            tickets: 3,
            revenue: 220000,
            fees: 11500,
            remaining: 14,
            held: 1,
          },
        );
        assert.deepEqual(result.categories, [
          { category: 'Concert', ticketsSold: 2, revenueKobo: 180000 },
          { category: 'Festival', ticketsSold: 1, revenueKobo: 40000 },
        ]);
        assert.deepEqual(
          result.topEvents.map((event) => [
            event.title,
            event.organiser,
            event.revenueKobo,
          ]),
          [
            ['Concert A', 'Owner A', 180000],
            ['Festival B', 'Owner B', 40000],
          ],
        );
        assert.ok(!JSON.stringify(result).includes('ada@example.com'));
      },
    );
    await t.test(
      'only the service role can call the analytics function',
      async () => {
        const { rows } = await db.query<{
          anon: boolean;
          authenticated: boolean;
          service: boolean;
        }>(
          "select has_function_privilege('anon','public.admin_sales_analytics()','execute') as anon, has_function_privilege('authenticated','public.admin_sales_analytics()','execute') as authenticated, has_function_privilege('service_role','public.admin_sales_analytics()','execute') as service",
        );
        assert.deepEqual(rows[0], {
          anon: false,
          authenticated: false,
          service: true,
        });
      },
    );
  } finally {
    await db.close();
  }
});
