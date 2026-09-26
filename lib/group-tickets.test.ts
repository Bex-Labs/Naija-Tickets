import assert from 'node:assert/strict';
import test from 'node:test';
import {
  databaseRowToPublicEvent,
  databaseRowToOrganiserEvent,
  type DatabaseEventRow,
} from './database-events.ts';
import { buildCustomerPurchases } from './customer-account.ts';
import { mapGuestOrder } from './guest-orders.ts';

void test('group availability converts admission inventory into whole packages', () => {
  const row: DatabaseEventRow = {
    id: 'event',
    title: 'Group Show',
    slug: 'group-show',
    description: 'Show',
    presenter_line: 'Events presents',
    venue_name: 'Hall',
    address: 'Road',
    city: 'Lagos',
    state: 'Lagos',
    timezone: 'Africa/Lagos',
    timezone_label: 'WAT',
    starts_at: '2090-01-01T18:00:00Z',
    ends_at: '2090-01-01T23:00:00Z',
    status: 'published',
    ticket_types: [
      {
        id: 'group',
        name: 'Squad Pass',
        price_kobo: 4500000,
        admissions_per_ticket: 5,
        quantity_total: 20,
        quantity_sold: 5,
        quantity_reserved: 5,
        min_per_order: 1,
        max_per_order: 6,
      },
    ],
  };
  assert.equal(databaseRowToPublicEvent(row).ticketTypes[0].remaining, 2);
  assert.equal(databaseRowToPublicEvent(row).ticketTypes[0].price, 4500000);
  const editor = databaseRowToOrganiserEvent(row).ticketTypes[0];
  assert.equal(editor.quantityTotal, 4);
  assert.equal(editor.quantitySold, 5);
  assert.equal(editor.admissionsPerTicket, 5);
  row.ticket_types![0].quantity_reserved = 11;
  assert.equal(databaseRowToPublicEvent(row).ticketTypes[0].remaining, 0);
  assert.equal(databaseRowToPublicEvent(row).ticketTypes[0].status, 'sold-out');
});

void test('customer purchase counts use the admission snapshot rather than package quantity', () => {
  const [purchase] = buildCustomerPurchases(
    [
      {
        id: 'order',
        reference: 'reference',
        status: 'paid',
        currency: 'NGN',
        subtotal_kobo: 9000000,
        fee_kobo: 450000,
        total_kobo: 9450000,
        created_at: '2026-09-26T00:00:00Z',
        paid_at: '2026-09-26T00:00:00Z',
        event_id: 'event',
      },
    ],
    [],
    [
      {
        id: 'item',
        order_id: 'order',
        quantity: 2,
        admissionsPerTicket: 5,
        ticketType: 'Squad Pass',
      },
    ],
    [],
    [],
  );
  assert.equal(purchase.quantity, 10);
  assert.equal(purchase.totalKobo, 9450000);
});

void test('admin guest purchase counts include every group admission', () => {
  const order = mapGuestOrder({
    id: 'order',
    reference: 'reference',
    status: 'paid',
    currency: 'NGN',
    total_kobo: 9450000,
    purchaser_name: 'Buyer',
    purchaser_email: 'buyer@example.com',
    purchaser_phone: '08012345678',
    created_at: '2026-09-26T00:00:00Z',
    events: { title: 'Group Show' },
    order_items: [{ quantity: 2, admissions_per_ticket: 5 }, { quantity: 1 }],
  });
  assert.equal(order.ticketCount, 11);
});
