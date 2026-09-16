import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOrganiserEventInput } from './organiser-event.ts';

function validEvent() {
  return {
    id: '',
    title: 'Eko Sounds Live',
    presenterLine: 'Palmwine Nights Collective presents',
    category: 'Concert',
    city: 'Lagos',
    venue: 'The Good Beach',
    address: '10B Trinity Avenue, Oniru, Lagos',
    directionsUrl: 'https://maps.google.com/example',
    date: '2026-09-19',
    time: '18:00',
    endDate: '2026-09-19',
    endTime: '23:00',
    timezoneLabel: 'WAT',
    salesStart: '2026-08-01T09:00',
    salesEnd: '2026-09-19T17:00',
    description:
      'A golden-hour celebration of Afrobeats, alte and highlife on the Lagos waterfront.',
    imageName: 'https://images.example.com/eko.jpg',
    organiserDisplayName: 'Palmwine Nights Collective',
    organiserAbout:
      'Independent live music experiences for artists and audiences.',
    schedule: [
      { time: '18:00', title: 'Doors open' },
      { time: '21:00', title: 'Headline performances' },
    ],
    policies: [{ text: 'Guests must bring valid identification.' }],
    ticketTypes: [
      {
        name: 'Community pass',
        description: 'General event admission.',
        priceNaira: 0,
        quantityTotal: 100,
        quantitySold: 0,
        quantityReserved: 0,
        minPerOrder: 1,
        maxPerOrder: 6,
        salesStart: '2026-08-01T09:00',
        salesEnd: '2026-09-19T17:00',
        inclusions: ['General admission'],
        active: true,
      },
      {
        name: 'Palmwine VIP',
        description: 'Priority event access.',
        priceNaira: 35000,
        quantityTotal: 20,
        quantitySold: 2,
        quantityReserved: 1,
        minPerOrder: 1,
        maxPerOrder: 4,
        salesStart: '',
        salesEnd: '',
        inclusions: ['Priority entry', 'Raised lounge access'],
        active: true,
      },
    ],
    status: 'draft',
  };
}

void test('parses structured event details and converts NGN prices to kobo', () => {
  const result = parseOrganiserEventInput(validEvent());
  assert.ok(result.value);
  assert.equal(result.value.ticketTypes[0].priceKobo, 0);
  assert.equal(result.value.ticketTypes[1].priceKobo, 3_500_000);
  assert.equal(result.value.schedule[1].title, 'Headline performances');
  assert.equal(result.value.timezoneLabel, 'WAT');
});

void test('rejects negative prices and fractional kobo amounts', () => {
  const negative = validEvent();
  negative.ticketTypes[0].priceNaira = -1;
  assert.match(
    parseOrganiserEventInput(negative).error || '',
    /non-negative NGN amounts/,
  );

  const fractional = validEvent();
  fractional.ticketTypes[0].priceNaira = 10.001;
  assert.match(
    parseOrganiserEventInput(fractional).error || '',
    /non-negative NGN amounts/,
  );
});

void test('rejects capacity below sold and reserved inventory', () => {
  const input = validEvent();
  input.ticketTypes[1].quantityTotal = 2;
  assert.match(
    parseOrganiserEventInput(input).error || '',
    /below sold and reserved inventory/,
  );
});

void test('rejects invalid URLs and event end times', () => {
  const urlInput = validEvent();
  urlInput.directionsUrl = 'javascript:alert(1)';
  assert.match(
    parseOrganiserEventInput(urlInput).error || '',
    /HTTP or HTTPS directions link/,
  );

  const timeInput = validEvent();
  timeInput.endTime = '17:59';
  assert.match(
    parseOrganiserEventInput(timeInput).error || '',
    /valid start and end dates and times/,
  );
});
