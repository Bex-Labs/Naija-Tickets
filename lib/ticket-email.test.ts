import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTicketEmail,
  ticketEmailIdempotencyKey,
  ticketStatusUrl,
  type TicketEmailDetails,
} from './ticket-email.ts';

const details: TicketEmailDetails = {
  orderReference: 'a4f67c8820f034574ab125f349d911accb90',
  eventTitle: 'Lagos Live',
  eventDate: '2026-09-19T17:00:00.000Z',
  eventVenue: 'Harbour Arena',
  eventCity: 'Lagos',
  eventAddress: '10 Marina Road, Lagos',
  eventTimezone: 'Africa/Lagos',
  eventTimezoneLabel: 'WAT',
  tickets: [
    {
      attendee_name: 'Ada Okafor',
      attendee_email: 'ada@example.com',
      display_code: 'NT-260919-08427',
      ticket_type: 'Regular',
    },
    {
      attendee_name: 'Tunde Bello',
      attendee_email: 'tunde@example.com',
      display_code: 'NT-260919-08428',
      ticket_type: 'VIP',
    },
  ],
};

void test('builds a branded email with every attendee and ticket detail', () => {
  const email = buildTicketEmail(details, 'https://tickets.example.com');

  assert.match(email.subject, /Lagos Live/);
  assert.match(email.text, /Ada Okafor/);
  assert.match(email.text, /Tunde Bello/);
  assert.match(email.text, /6:00 PM WAT/);
  assert.match(email.html, /Harbour Arena/);
  assert.match(email.html, /NT-260919-08427/);
  assert.equal(
    email.ticketUrl,
    'https://tickets.example.com/payment/status?reference=a4f67c8820f034574ab125f349d911accb90',
  );
});

void test('escapes attendee data before adding it to email HTML', () => {
  const email = buildTicketEmail(
    {
      ...details,
      tickets: [{ ...details.tickets[0], attendee_name: '<b>Ada</b>' }],
    },
    'http://localhost:3000',
  );

  assert.doesNotMatch(email.html, /<b>Ada<\/b>/);
  assert.match(email.html, /&lt;b&gt;Ada&lt;\/b&gt;/);
});

void test('uses one stable idempotency key and rejects insecure public links', () => {
  assert.equal(
    ticketEmailIdempotencyKey(details.orderReference),
    `tickets/${details.orderReference}`,
  );
  assert.throws(
    () => ticketStatusUrl('http://tickets.example.com', details.orderReference),
    /HTTPS/,
  );
});
