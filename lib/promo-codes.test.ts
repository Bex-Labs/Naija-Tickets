import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePromoCodeInput } from './promo-codes.ts';

const input = {
  eventId: '11111111-1111-4111-8111-111111111111',
  code: ' early_20 ',
  discountType: 'percentage',
  discountValue: '12.50',
  startsAt: '2026-09-20T09:00:00+01:00',
  endsAt: '2026-09-21T09:00:00+01:00',
  usageLimit: 10,
  ticketTypeIds: ['22222222-2222-4222-8222-222222222222'],
};
void test('normalizes codes, WAT dates and exact percentage basis points', () => {
  assert.deepEqual(parsePromoCodeInput(input), {
    eventId: input.eventId,
    code: 'EARLY_20',
    discountType: 'percentage',
    discountValue: 1250,
    startsAt: '2026-09-20T08:00:00.000Z',
    endsAt: '2026-09-21T08:00:00.000Z',
    usageLimit: 10,
    ticketTypeIds: input.ticketTypeIds,
  });
});
void test('converts fixed naira to kobo and allows event-wide scope', () => {
  const parsed = parsePromoCodeInput({
    ...input,
    discountType: 'fixed',
    discountValue: '1500.01',
    ticketTypeIds: [],
  });
  assert.equal(parsed?.discountValue, 150001);
  assert.deepEqual(parsed?.ticketTypeIds, []);
});
void test('rejects invalid code, value, dates, limits and scope', () => {
  for (const change of [
    { code: 'A B' },
    { code: 'a'.repeat(33) },
    { code: 'AB' },
    { discountValue: '100.01' },
    { discountValue: '0' },
    { discountValue: '-5' },
    { discountValue: '1.001' },
    { discountValue: '1e2' },
    { discountValue: '' },
    { discountType: 'unknown' },
    { usageLimit: 0 },
    { usageLimit: 1.5 },
    { usageLimit: 1000001 },
    { endsAt: input.startsAt },
    { startsAt: 'invalid' },
    { startsAt: '2026-09-20T09:00' },
    { ticketTypeIds: ['invalid'] },
    { ticketTypeIds: null },
    { eventId: 'invalid' },
  ])
    assert.equal(
      parsePromoCodeInput({ ...input, ...change }),
      null,
      JSON.stringify(change),
    );
});
