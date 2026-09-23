import assert from 'node:assert/strict';
import test from 'node:test';
import type { Event } from './events.ts';
import { selectTrendingEvents } from './trending-events.ts';

function event(
  slug: string,
  date: string,
  ticketsSold: number,
  featured = false,
): Event {
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
    time: '18:00 WAT',
    image: 'https://example.com/event.jpg',
    description: 'Event description',
    featured,
    ticketsSold,
    ticketTypes: [],
    schedule: [],
    policies: [],
  };
}

void test('ranks upcoming events by tickets sold', () => {
  const result = selectTrendingEvents(
    [
      event('moderate', '2026-09-21', 20),
      event('past-hit', '2026-09-16', 500),
      event('popular', '2026-10-02', 80),
      event('quiet', '2026-09-20', 2),
    ],
    4,
    '2026-09-17',
  );

  assert.deepEqual(
    result.map((item) => item.slug),
    ['popular', 'moderate', 'quiet'],
  );
});

void test('uses featured status, date and slug as deterministic tie-breakers', () => {
  const result = selectTrendingEvents(
    [
      event('later', '2026-10-01', 10),
      event('alpha', '2026-09-20', 10),
      event('featured', '2026-11-01', 10, true),
      event('beta', '2026-09-20', 10),
    ],
    3,
    '2026-09-17',
  );

  assert.deepEqual(
    result.map((item) => item.slug),
    ['featured', 'alpha', 'beta'],
  );
});

void test('deduplicates events and respects the display limit', () => {
  const first = event('first', '2026-09-20', 4);
  assert.deepEqual(
    selectTrendingEvents(
      [first, first, event('second', '2026-09-21', 3)],
      1,
      '2026-09-17',
    ).map((item) => item.slug),
    ['first'],
  );
});

void test('excludes unverified organiser events from trending placement', () => {
  const unverified = {
    ...event('unverified', '2026-09-20', 500),
    organiserVerified: false,
  };
  assert.deepEqual(selectTrendingEvents([unverified], 4, '2026-09-17'), []);
});
