import assert from 'node:assert/strict';
import test from 'node:test';
import {
  retrieveTicketOrder,
  type StoredTicketOrder,
  type TicketOrderSource,
} from './order-ticket-access.ts';

const reference = 'a4f67c8820f034574ab125f349d911accb90';

function sourceFor(
  order: StoredTicketOrder | null,
  counters = { order: 0, event: 0, items: 0, tickets: 0 },
): TicketOrderSource {
  return {
    async findOrder() {
      counters.order += 1;
      return order;
    },
    async findEvent() {
      counters.event += 1;
      return {
        title: 'Eko Sounds Live',
        presenterLine: 'Palmwine Nights Collective presents',
        category: 'Concert',
        startsAt: '2026-09-19T17:00:00.000Z',
        timezone: 'Africa/Lagos',
        timezoneLabel: 'WAT',
        venue: 'The Good Beach',
        city: 'Lagos',
        address: '10B Trinity Avenue, Oniru, Lagos',
      };
    },
    async findOrderItems() {
      counters.items += 1;
      return [{ id: 'item-1', ticketType: 'Regular', unitPriceKobo: 850000 }];
    },
    async findIssuedTickets() {
      counters.tickets += 1;
      return [
        {
          id: 'ticket-1',
          orderItemId: 'item-1',
          attendeeName: 'Ada Okafor',
          displayCode: 'NT-260919-08427',
          status: 'valid',
          issuedAt: '2026-09-15T16:00:00.000Z',
        },
      ];
    },
  };
}

void test('rejects malformed bearer references before any database read', async () => {
  const counters = { order: 0, event: 0, items: 0, tickets: 0 };
  const result = await retrieveTicketOrder(
    '../orders',
    sourceFor(null, counters),
  );

  assert.deepEqual(result, { state: 'invalid' });
  assert.deepEqual(counters, { order: 0, event: 0, items: 0, tickets: 0 });
});

void test('never reads or exposes ticket codes for an unpaid order', async () => {
  for (const status of ['pending', 'failed', 'abandoned', 'expired']) {
    const counters = { order: 0, event: 0, items: 0, tickets: 0 };
    const result = await retrieveTicketOrder(
      reference,
      sourceFor(
        {
          id: 'order-1',
          reference,
          status,
          currency: 'NGN',
          event_id: 'event-1',
        },
        counters,
      ),
    );

    assert.equal(
      result.state,
      status === 'pending'
        ? 'pending'
        : status === 'expired'
          ? 'expired'
          : 'failed',
    );
    assert.deepEqual(counters, { order: 1, event: 0, items: 0, tickets: 0 });
  }

  const failedPaymentCounters = {
    order: 0,
    event: 0,
    items: 0,
    tickets: 0,
  };
  const failedPayment = await retrieveTicketOrder(
    reference,
    sourceFor(
      {
        id: 'order-1',
        reference,
        status: 'pending',
        paymentStatus: 'failed',
        currency: 'NGN',
        event_id: 'event-1',
      },
      failedPaymentCounters,
    ),
  );
  assert.equal(failedPayment.state, 'failed');
  assert.deepEqual(failedPaymentCounters, {
    order: 1,
    event: 0,
    items: 0,
    tickets: 0,
  });
});

void test('returns verified event and ticket data only for a paid order', async () => {
  const counters = { order: 0, event: 0, items: 0, tickets: 0 };
  const result = await retrieveTicketOrder(
    reference.toUpperCase(),
    sourceFor(
      {
        id: 'order-1',
        reference,
        status: 'paid',
        paymentStatus: 'verified',
        currency: 'NGN',
        event_id: 'event-1',
      },
      counters,
    ),
  );

  assert.equal(result.state, 'success');
  if (result.state !== 'success') return;
  assert.equal(result.order.event.title, 'Eko Sounds Live');
  assert.equal(result.order.tickets[0].displayCode, 'NT-260919-08427');
  assert.equal(result.order.tickets[0].unitPriceKobo, 850000);
  assert.deepEqual(counters, { order: 1, event: 1, items: 1, tickets: 1 });
});

void test('partial refunds retain verified ticket access; full refunds do not expose codes', async () => {
  const partial = await retrieveTicketOrder(
    reference,
    sourceFor({
      id: 'order-1',
      reference,
      status: 'partially_refunded',
      paymentStatus: 'verified',
      currency: 'NGN',
      event_id: 'event-1',
    }),
  );
  assert.equal(partial.state, 'success');

  const counters = { order: 0, event: 0, items: 0, tickets: 0 };
  const full = await retrieveTicketOrder(
    reference,
    sourceFor(
      {
        id: 'order-1',
        reference,
        status: 'refunded',
        paymentStatus: 'refunded',
        currency: 'NGN',
        event_id: 'event-1',
      },
      counters,
    ),
  );
  assert.deepEqual(full, { state: 'refunded' });
  assert.deepEqual(counters, { order: 1, event: 0, items: 0, tickets: 0 });

  const unverified = await retrieveTicketOrder(
    reference,
    sourceFor(
      {
        id: 'order-1',
        reference,
        status: 'paid',
        paymentStatus: 'pending',
        currency: 'NGN',
        event_id: 'event-1',
      },
      counters,
    ),
  );
  assert.equal(unverified.state, 'failed');
});

void test('paid group bookings are available before any attendee has claimed a QR', async () => {
  let groupReads = 0;
  const order = {
    id: 'order-1',
    reference,
    status: 'paid',
    paymentStatus: 'verified',
    currency: 'NGN',
    event_id: 'event-1',
  };
  const source = {
    ...sourceFor(order),
    async findIssuedTickets() {
      return [];
    },
    async findGroupBookings() {
      groupReads += 1;
      return [
        {
          id: 'group-1',
          orderItemId: 'item-1',
          ticketName: 'Squad Pass',
          buyerName: 'Buyer',
          admissions: 5,
          registered: 0,
          remaining: 5,
          checkedIn: 0,
          invitePath: '/groups/' + 'a'.repeat(64),
          members: [],
        },
      ];
    },
  };
  const result = await retrieveTicketOrder(reference, source);
  assert.equal(result.state, 'success');
  if (result.state === 'success') {
    assert.equal(result.order.tickets.length, 0);
    assert.equal(result.order.groups?.[0].remaining, 5);
  }
  source.findOrder = async () => ({ ...order, paymentStatus: 'pending' });
  await retrieveTicketOrder(reference, source);
  assert.equal(
    groupReads,
    1,
    'unverified payments must not reveal a group invite',
  );
});
