import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterGuestOrders,
  mapGuestOrder,
  type GuestOrderRow,
} from './guest-orders.ts';

function row(overrides: Partial<GuestOrderRow> = {}): GuestOrderRow {
  return {
    id: 'b65e63e0-8dc1-4fa3-9121-198f635901ec',
    reference: 'a4f67c8820f034574ab125f349d911accb90',
    status: 'paid',
    currency: 'NGN',
    total_kobo: 1850000,
    purchaser_name: 'Ada Okafor',
    purchaser_email: 'ada@example.com',
    purchaser_phone: '+2348012345678',
    created_at: '2026-09-15T16:00:00.000Z',
    personal_data_erased_at: null,
    events: { title: 'Lagos Live' },
    order_items: [{ quantity: 2 }, { quantity: 1 }],
    ...overrides,
  };
}

void test('maps a guest order with its event and purchased ticket count', () => {
  const order = mapGuestOrder(row());

  assert.equal(order.eventTitle, 'Lagos Live');
  assert.equal(order.ticketCount, 3);
  assert.equal(order.totalKobo, 1850000);
  assert.equal(order.purchaserEmail, 'ada@example.com');
});

void test('never returns stored placeholder contact fields after erasure', () => {
  const order = mapGuestOrder(
    row({
      personal_data_erased_at: '2026-09-16T10:00:00.000Z',
      purchaser_name: 'Guest data removed',
      purchaser_email: 'erased+record@privacy.naijatickets.invalid',
      purchaser_phone: 'Removed',
    }),
  );

  assert.equal(order.purchaserName, 'Personal data removed');
  assert.equal(order.purchaserEmail, '');
  assert.equal(order.purchaserPhone, '');
});

void test('searches guest purchases across contact, event, reference and status', () => {
  const first = mapGuestOrder(row());
  const second = mapGuestOrder(
    row({
      id: '8cf96ac3-b7a1-409a-b0f6-2258de524951',
      reference: 'b4f67c8820f034574ab125f349d911accb91',
      purchaser_name: 'Tunde Bello',
      purchaser_email: 'tunde@example.com',
      events: [{ title: 'Abuja Ideas Forum' }],
      status: 'pending',
    }),
  );

  assert.deepEqual(filterGuestOrders([first, second], 'abuja'), [second]);
  assert.deepEqual(filterGuestOrders([first, second], 'ada@example'), [first]);
  assert.deepEqual(filterGuestOrders([first, second], 'pending'), [second]);
});
