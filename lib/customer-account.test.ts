import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCustomerPurchases,
  buildCustomerSavedEvents,
} from './customer-account.ts';

void test('customer purchases include account-linked tickets and totals', () => {
  const purchases = buildCustomerPurchases(
    [
      {
        id: 'order-1',
        reference: 'ref-1',
        status: 'paid',
        currency: 'NGN',
        subtotal_kobo: 100000,
        discount_kobo: 10000,
        fee_kobo: 5000,
        total_kobo: 95000,
        created_at: '2026-09-20T10:00:00Z',
        paid_at: '2026-09-20T10:05:00Z',
        event_id: 'event-1',
      },
    ],
    [
      {
        id: 'event-1',
        title: 'Lagos Live',
        slug: 'lagos-live',
        starts_at: '2026-10-01T18:00:00Z',
        timezone: 'Africa/Lagos',
        timezone_label: 'WAT',
        venue_name: 'Arena',
        city: 'Lagos',
        image_path: '/event.jpg',
      },
    ],
    [{ id: 'item-1', order_id: 'order-1', quantity: 2, ticketType: 'VIP' }],
    [
      {
        id: 'ticket-1',
        order_item_id: 'item-1',
        attendee_name: 'Ada Okafor',
        display_code: 'NT-1234',
        status: 'valid',
        issued_at: '2026-09-20T10:05:00Z',
      },
    ],
    [
      {
        order_id: 'order-1',
        status: 'pending',
        created_at: '2026-09-20T10:01:00Z',
      },
      {
        order_id: 'order-1',
        status: 'verified',
        created_at: '2026-09-20T10:05:00Z',
      },
    ],
  );
  assert.equal(purchases[0].quantity, 2);
  assert.equal(purchases[0].tickets[0].ticketType, 'VIP');
  assert.equal(purchases[0].totalKobo, 95000);
  assert.equal(purchases[0].event?.slug, 'lagos-live');
  assert.equal(purchases[0].paymentStatus, 'verified');
});

void test('saved events preserve unavailable records without linking to them', () => {
  const saved = buildCustomerSavedEvents(
    [
      { event_id: 'published', created_at: '2026-09-22T10:00:00Z' },
      { event_id: 'unavailable', created_at: '2026-09-21T10:00:00Z' },
    ],
    [
      {
        id: 'published',
        title: 'Lagos Live',
        slug: 'lagos-live',
        starts_at: '2026-10-01T18:00:00Z',
        timezone: 'Africa/Lagos',
        timezone_label: 'WAT',
        venue_name: 'Arena',
        city: 'Lagos',
        image_path: '/event.jpg',
        status: 'published',
      },
      {
        id: 'unavailable',
        title: 'Paused event',
        slug: 'paused-event',
        starts_at: '2026-10-02T18:00:00Z',
        timezone: 'Africa/Lagos',
        timezone_label: 'WAT',
        venue_name: 'Hall',
        city: 'Abuja',
        image_path: null,
        status: 'submitted',
      },
    ],
  );
  assert.equal(saved[0].available, true);
  assert.equal(saved[0].slug, 'lagos-live');
  assert.equal(saved[1].available, false);
  assert.equal(saved[1].slug, null);
  assert.equal(saved[1].title, 'Paused event');
});
