import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupCounts,
  parseGroupClaim,
  GROUP_TOKEN_PATTERN,
} from './group-bookings.ts';
void test('group totals distinguish waiting, claimed and checked in members', () => {
  assert.deepEqual(
    groupCounts([
      { id: '1', name: null, state: 'UNCLAIMED', status: 'valid' },
      { id: '2', name: 'Ada', state: 'CLAIMED', status: 'valid' },
      { id: '3', name: 'Abbas', state: 'CHECKED_IN', status: 'used' },
    ]),
    { registered: 2, remaining: 1, checkedIn: 1 },
  );
});
void test('attendee claims validate and normalise contact details', () => {
  assert.deepEqual(
    parseGroupClaim({
      name: ' Ada Okafor ',
      email: ' ADA@example.com ',
      phone: ' +234 801 234 5678 ',
    }),
    {
      name: 'Ada Okafor',
      email: 'ada@example.com',
      phone: '+234 801 234 5678',
    },
  );
  for (const value of [
    null,
    {},
    { name: 'A', email: 'ada@example.com', phone: '08012345678' },
    { name: 'Ada', email: 'bad', phone: '08012345678' },
    { name: 'Ada', email: 'ada@example.com', phone: '123' },
  ])
    assert.equal(parseGroupClaim(value), null);
  assert.equal(GROUP_TOKEN_PATTERN.test('a'.repeat(64)), true);
  assert.equal(GROUP_TOKEN_PATTERN.test('a'.repeat(36)), false);
});
