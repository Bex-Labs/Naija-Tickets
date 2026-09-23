import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectFeaturedEvents,
  selectUpcomingEvents,
} from './featured-events.ts';
import type { Event } from './events.ts';

function event(slug: string, date: string, featured = true): Event {
  return {
    id: slug,
    slug,
    title: slug,
    organiser: 'Organiser',
    organiserVerified: true,
    city: 'Lagos',
    state: 'Lagos',
    venue: 'Venue',
    address: 'Address',
    category: 'Concert',
    date,
    displayDate: date,
    time: '6:00 PM WAT',
    image: 'https://example.com/event.jpg',
    description: 'Event description',
    featured,
    ticketTypes: [],
    schedule: [],
    policies: [],
  };
}

void test('returns only explicit featured events in deterministic order', () => {
  const result = selectFeaturedEvents([
    event('later', '2026-11-10'),
    event('not-featured', '2026-09-01', false),
    event('earlier-b', '2026-10-01'),
    event('earlier-a', '2026-10-01'),
  ]);

  assert.deepEqual(
    result.map((item) => item.slug),
    ['earlier-a', 'earlier-b', 'later'],
  );
});

void test('deduplicates featured records and respects the display limit', () => {
  const first = event('first', '2026-09-20');
  assert.deepEqual(
    selectFeaturedEvents([first, first, event('second', '2026-09-21')], 1).map(
      (item) => item.slug,
    ),
    ['first'],
  );
  assert.deepEqual(selectFeaturedEvents([], 3), []);
});

void test('excludes unverified organiser events from featured placement', () => {
  const unverified = {
    ...event('unverified', '2026-09-20'),
    organiserVerified: false,
  };
  assert.deepEqual(selectFeaturedEvents([unverified]), []);
});

void test('does not repeat displayed featured events in the upcoming list', () => {
  const alpha = event('alpha', '2026-09-01');
  const duplicateSlug = { ...event('alpha', '2026-09-02'), id: 'other-id' };
  const beta = event('beta', '2026-09-03', false);
  const gamma = event('gamma', '2026-09-04');

  assert.deepEqual(
    selectUpcomingEvents([beta, duplicateSlug, gamma, alpha], 1).map(
      (item) => item.slug,
    ),
    ['beta', 'gamma'],
  );
});
