import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  aggregateOrganiserSales,
  type EventSalesRow,
} from './organiser-analytics.ts';
import { createPromoTestDatabase } from './test-support/promo-database.ts';

void test('sales analytics uses verified sales and organiser membership', async (t) => {
  const db = await createPromoTestDatabase();
  try {
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200002_organiser_sales_analytics.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    // Reproduce Supabase's direct default grants before the permission patch.
    await db.exec(`
      grant execute on function public.organiser_sales_analytics(uuid) to anon, authenticated;
      grant execute on function public.create_organiser_promo_code(uuid,uuid,text,text,bigint,timestamptz,timestamptz,integer,uuid[]) to anon, authenticated;
      grant execute on function public.create_checkout_reservation_v3(uuid,uuid,jsonb,jsonb,text,text) to anon, authenticated;
    `);
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200003_private_organiser_function_permissions.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.exec(`
      grant execute on function public.finalize_paystack_payment(text,text,bigint,text,text,jsonb,text,text,text) to anon, authenticated;
    `);
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202609200004_private_security_definer_permissions.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const owner = '10000000-0000-4000-8000-000000000001';
    const outsider = '10000000-0000-4000-8000-000000000002';
    const concert = '20000000-0000-4000-8000-000000000001';
    const festival = '20000000-0000-4000-8000-000000000002';
    const foreign = '20000000-0000-4000-8000-000000000003';
    const ticket = '30000000-0000-4000-8000-000000000001';
    const hidden = '30000000-0000-4000-8000-000000000002';
    const festivalTicket = '30000000-0000-4000-8000-000000000003';
    const foreignTicket = '30000000-0000-4000-8000-000000000004';
    await db.exec(`
      insert into auth.users values ('${owner}'), ('${outsider}');
      insert into public.profiles(id,full_name) values ('${owner}','Owner'), ('${outsider}','Other');
      insert into public.organisers(id,name,slug,contact_email) values ('${owner}','Owner','owner','owner@example.com'), ('${outsider}','Other','other','other@example.com');
      insert into public.organiser_memberships(organiser_id,user_id) values ('${owner}','${owner}'), ('${outsider}','${outsider}');
      insert into public.categories(id,name,slug) values ('${owner}','Concert','concert'), ('${outsider}','Festival','festival');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status) values
        ('${concert}','${owner}','${owner}','Owner concert','owner-concert','Show','Hall','Road','Lagos','Lagos',now()+interval '10 days',now()+interval '11 days','published'),
        ('${festival}','${owner}','${outsider}','Owner festival','owner-festival','Show','Hall','Road','Lagos','Lagos',now()+interval '12 days',now()+interval '13 days','published'),
        ('${foreign}','${outsider}','${owner}','Other concert','other-concert','Show','Hall','Road','Lagos','Lagos',now()+interval '14 days',now()+interval '15 days','published');
      insert into public.ticket_types(id,event_id,name,price_kobo,quantity_total,quantity_sold,quantity_reserved,active) values
        ('${ticket}','${concert}','General',100000,10,3,3,true),
        ('${hidden}','${concert}','Closed',100000,20,0,0,false),
        ('${festivalTicket}','${festival}','Festival',50000,5,1,0,true),
        ('${foreignTicket}','${foreign}','Other',100000,30,1,0,true);
    `);
    const addOrder = async (
      index: number,
      eventId: string,
      ticketId: string,
      status: string,
      paymentStatus: string,
      quantity: number,
      subtotal: number,
      discount = 0,
      fee = 0,
    ) => {
      const orderId = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const itemId = `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await db.query(
        `insert into public.orders(id,event_id,status,purchaser_name,purchaser_email,purchaser_phone,checkout_token_hash,subtotal_kobo,discount_kobo,fee_kobo,total_kobo)
        values ($1,$2,$3,'Ada Guest','ada@example.com','08012345678',$4,$5,$6,$7,$8)`,
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
        `insert into public.order_items(id,order_id,ticket_type_id,quantity,unit_price_kobo,line_total_kobo,attendee_data)
        values ($1,$2,$3,$4,$5,$6,'[]'::jsonb)`,
        [itemId, orderId, ticketId, quantity, subtotal / quantity, subtotal],
      );
      await db.query(
        `insert into public.payments(order_id,provider,provider_reference,status,amount_kobo) values ($1,'paystack',$2,$3,$4)`,
        [orderId, `payment-${index}`, paymentStatus, subtotal - discount + fee],
      );
      for (let i = 0; i < quantity; i++) {
        await db.query(
          `insert into public.tickets(order_item_id,event_id,attendee_index,attendee_name,attendee_email,qr_token_hash,display_code,status) values ($1,$2,$3,'Ada Guest','ada@example.com',$4,$5,$6)`,
          [
            itemId,
            eventId,
            i,
            `qr-${index}-${i}`,
            `NT-${index}-${i}`,
            i === quantity - 1 && index === 1 ? 'refunded' : 'valid',
          ],
        );
      }
      return orderId;
    };
    await addOrder(
      1,
      concert,
      ticket,
      'paid',
      'verified',
      3,
      300000,
      30000,
      13500,
    );
    await addOrder(
      2,
      festival,
      festivalTicket,
      'paid',
      'verified',
      1,
      50000,
      0,
      2500,
    );
    await addOrder(3, concert, ticket, 'paid', 'pending', 1, 100000);
    await addOrder(4, concert, ticket, 'pending', 'verified', 1, 100000);
    await addOrder(5, foreign, foreignTicket, 'paid', 'verified', 1, 100000);
    const partialId = await addOrder(
      6,
      concert,
      ticket,
      'partially_refunded',
      'verified',
      1,
      100000,
      0,
      5000,
    );
    await db.query(
      `insert into public.refunds(order_id,requested_by,reason,amount_kobo,status,provider_confirmed_at) values ($1,$2,'Partial refund',25000,'completed',now())`,
      [partialId, owner],
    );
    await addOrder(7, concert, ticket, 'refunded', 'verified', 1, 100000);
    await addOrder(8, concert, ticket, 'pending', 'pending', 1, 100000);
    await addOrder(9, concert, ticket, 'pending', 'pending', 1, 100000);
    await db.exec(`
      insert into public.reservations(order_item_id,ticket_type_id,quantity,expires_at) values
        ('50000000-0000-4000-8000-000000000004','${ticket}',1,now()+interval '10 minutes'),
        ('50000000-0000-4000-8000-000000000008','${ticket}',1,now()+interval '10 minutes'),
        ('50000000-0000-4000-8000-000000000009','${ticket}',1,now()-interval '1 minute');
    `);

    await t.test(
      'includes only verified, non-refunded orders and issued tickets',
      async () => {
        const { rows } = await db.query<EventSalesRow>(
          'select * from public.organiser_sales_analytics($1)',
          [owner],
        );
        const summary = aggregateOrganiserSales(rows);
        assert.equal(summary.events.length, 2);
        assert.equal(summary.ticketsSold, 4);
        assert.equal(summary.revenueKobo, 395000);
        assert.equal(summary.inventoryRemaining, 9);
        assert.equal(summary.inventoryReserved, 2);
        assert.deepEqual(
          summary.categories.map(({ category, ticketsSold, revenueKobo }) => ({
            category,
            ticketsSold,
            revenueKobo,
          })),
          [
            { category: 'Concert', ticketsSold: 3, revenueKobo: 345000 },
            { category: 'Festival', ticketsSold: 1, revenueKobo: 50000 },
          ],
        );
        assert.ok(
          summary.events.every((event) => event.title.startsWith('Owner')),
        );
      },
    );
    await t.test('another organiser sees only their own event', async () => {
      const { rows } = await db.query<EventSalesRow>(
        'select * from public.organiser_sales_analytics($1)',
        [outsider],
      );
      const summary = aggregateOrganiserSales(rows);
      assert.deepEqual(
        summary.events.map((event) => event.eventId),
        [foreign],
      );
      assert.equal(summary.ticketsSold, 1);
    });
    await t.test(
      'public API roles cannot execute private analytics or promo functions',
      async () => {
        const { rows } = await db.query<Record<string, boolean>>(`select
        has_function_privilege('anon','public.organiser_sales_analytics(uuid)','execute') as anon_analytics,
        has_function_privilege('authenticated','public.organiser_sales_analytics(uuid)','execute') as authenticated_analytics,
        has_function_privilege('anon','public.create_organiser_promo_code(uuid,uuid,text,text,bigint,timestamptz,timestamptz,integer,uuid[])','execute') as anon_promo,
        has_function_privilege('authenticated','public.create_checkout_reservation_v3(uuid,uuid,jsonb,jsonb,text,text)','execute') as authenticated_checkout,
        has_function_privilege('anon','public.finalize_paystack_payment(text,text,bigint,text,text,jsonb,text,text,text)','execute') as anon_payment,
        has_function_privilege('authenticated','public.has_role(app_role)','execute') as role_check_available,
        has_function_privilege('service_role','public.finalize_paystack_payment(text,text,bigint,text,text,jsonb,text,text,text)','execute') as service_payment,
        has_function_privilege('service_role','public.organiser_sales_analytics(uuid)','execute') as service_analytics`);
        assert.deepEqual(rows[0], {
          anon_analytics: false,
          authenticated_analytics: false,
          anon_promo: false,
          authenticated_checkout: false,
          anon_payment: false,
          role_check_available: true,
          service_payment: true,
          service_analytics: true,
        });
      },
    );
    await t.test('organiser with no events gets an empty result', async () => {
      const { rows } = await db.query(
        'select * from public.organiser_sales_analytics($1)',
        ['10000000-0000-4000-8000-000000000099'],
      );
      assert.deepEqual(rows, []);
    });
  } finally {
    await db.close();
  }
});
