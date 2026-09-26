import assert from 'node:assert/strict';
import test from 'node:test';
import { eventHasEnded } from './event-availability.ts';
import { buildCustomerSavedEvents } from './customer-account.ts';

void test('events expire at the finish time, including overnight events in WAT', () => {
  const end = '2026-09-27T01:00:00+01:00';
  assert.equal(eventHasEnded(end, Date.parse('2026-09-26T23:59:59Z')), false);
  assert.equal(eventHasEnded(end, Date.parse('2026-09-27T00:00:00Z')), true);
  assert.equal(eventHasEnded(end, Date.parse('2026-09-28T00:00:00Z')), true);
  assert.equal(eventHasEnded('invalid'), true);
});

void test('ended saved events retain history without a public event link', () => {
  const [saved] = buildCustomerSavedEvents(
    [{ event_id: 'past', created_at: '2026-09-20T00:00:00Z' }],
    [
      {
        id: 'past',
        title: 'Past show',
        slug: 'past-show',
        starts_at: '2026-09-25T18:00:00Z',
        ends_at: '2026-09-25T22:00:00Z',
        timezone: 'Africa/Lagos',
        timezone_label: 'WAT',
        venue_name: 'Hall',
        city: 'Lagos',
        image_path: null,
        status: 'published',
      },
    ],
    Date.parse('2026-09-26T00:00:00Z'),
  );
  assert.equal(saved.available, false);
  assert.equal(saved.slug, null);
  assert.equal(saved.title, 'Past show');
});
