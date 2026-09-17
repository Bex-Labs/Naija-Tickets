import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TicketType } from './events.ts';
import { isEarlyBirdTicket, ticketPrice } from './events.ts';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/202609170002_early_bird_ticket_pricing.sql',
    import.meta.url,
  ),
  'utf8',
);

function ticket(overrides: Partial<TicketType> = {}): TicketType {
  return {
    name: 'General admission',
    price: 2_000_000,
    remaining: 100,
    ...overrides,
  };
}

void test('uses the early bird price before its deadline', () => {
  const offer = ticket({
    earlyBirdPrice: 1_500_000,
    earlyBirdEndsAt: '2026-10-01T12:00:00.000Z',
  });
  const beforeDeadline = new Date('2026-10-01T11:59:59.999Z').getTime();
  assert.equal(isEarlyBirdTicket(offer, beforeDeadline), true);
  assert.equal(ticketPrice(offer, beforeDeadline), 1_500_000);
});

void test('automatically returns to the standard price at the deadline', () => {
  const offer = ticket({
    earlyBirdPrice: 1_500_000,
    earlyBirdEndsAt: '2026-10-01T12:00:00.000Z',
  });
  const deadline = new Date('2026-10-01T12:00:00.000Z').getTime();
  assert.equal(isEarlyBirdTicket(offer, deadline), false);
  assert.equal(ticketPrice(offer, deadline), 2_000_000);
});

void test('uses the standard price when no early bird offer exists', () => {
  assert.equal(ticketPrice(ticket(), Date.now()), 2_000_000);
});

void test('database checkout recalculates the active price before reserving', () => {
  const refreshPosition = migration.indexOf(
    'update public.ticket_types as ticket',
  );
  const reservationPosition = migration.indexOf(
    'from public.create_checkout_reservation(',
  );

  assert.ok(refreshPosition >= 0);
  assert.ok(reservationPosition > refreshPosition);
  assert.match(
    migration,
    /ticket\.early_bird_ends_at > now\(\)[\s\S]*else ticket\.standard_price_kobo/,
  );
});

void test('database rejects incomplete or non-discounted early bird offers', () => {
  assert.match(migration, /ticket_types_early_bird_pair/);
  assert.match(migration, /early_bird_price_kobo < standard_price_kobo/);
});
