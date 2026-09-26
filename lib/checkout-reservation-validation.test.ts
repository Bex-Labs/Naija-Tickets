import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHECKOUT_TICKETS_PER_TYPE,
  validReservationItem,
} from './checkout-reservation-validation.ts';

const ticketTypeId = '11111111-1111-4111-8111-111111111111';
const attendee = {
  name: 'Ada Okafor',
  email: 'ada@example.com',
  phone: '08012345678',
};
const item = (quantity: number) => ({
  ticketTypeId,
  quantity,
  attendees: Array.from({ length: quantity }, () => ({ ...attendee })),
});

void test('checkout accepts multiple tickets through the organiser limit', () => {
  assert.equal(validReservationItem(item(7)), true);
  assert.equal(validReservationItem(item(MAX_CHECKOUT_TICKETS_PER_TYPE)), true);
  assert.equal(
    validReservationItem(item(MAX_CHECKOUT_TICKETS_PER_TYPE + 1)),
    false,
  );
});

void test('checkout still requires details for every selected ticket', () => {
  assert.equal(
    validReservationItem({ ...item(2), attendees: [attendee] }),
    false,
  );
  assert.equal(
    validReservationItem({
      ...item(2),
      attendees: [attendee, { ...attendee, phone: '123' }],
    }),
    false,
  );
});

void test('group checkout requires no attendee details and uses the stored group size', () => {
  const group = { ...item(2), attendees: [] };
  assert.equal(validReservationItem(group, 5), true);
  assert.equal(validReservationItem(group), false);
  assert.equal(validReservationItem(item(2), 5), false);
  assert.equal(validReservationItem(group, 0), false);
  assert.equal(validReservationItem(group, 2.5), false);
  assert.equal(validReservationItem({ ...group, quantity: 5 }, 100), false);
});
