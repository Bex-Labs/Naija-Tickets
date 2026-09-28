import assert from 'node:assert/strict';
import test from 'node:test';
import { ticketTextLines } from './ticket-artwork.ts';

void test('ticket text wraps without losing attendee or event information', () => {
  const value = 'A very long event title for the Lagos festival';
  const lines = ticketTextLines(value, 20);
  assert.equal(lines.join(' '), value);
  assert.ok(lines.every((line) => line.length <= 20));
  assert.equal(ticketTextLines('W'.repeat(90), 27).join(''), 'W'.repeat(90));
  assert.deepEqual(ticketTextLines('', 20), ['']);
});
