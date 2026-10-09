import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTicketEmailArtwork } from './ticket-email-artwork.ts';

void test('renders the issued ticket as an email-ready PNG attachment', async () => {
  const [ticket] = await renderTicketEmailArtwork([
    {
      eventTitle: 'Eko Sounds Live',
      category: 'Live music',
      presenter: 'Palmwine Nights Collective presents',
      date: 'Saturday, 19 September 2026',
      time: '6:00 PM WAT',
      venue: 'The Good Beach, Lagos',
      address: '10B Trinity Avenue, Oniru, Lagos',
      ticketType: 'Regular admission',
      attendeeName: 'Ada Okafor',
      price: '₦8,500',
      priceLabel: 'Unit price',
      displayCode: 'NT-260919-08427',
      orderReference: 'ORDER-TEST-2026',
      position: 'Ticket 1 of 1',
    },
  ]);
  const image = Buffer.from(ticket.content, 'base64');

  assert.equal(ticket.filename, 'NT-260919-08427.png');
  assert.equal(ticket.contentType, 'image/png');
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.ok(image.length > 10_000);
});
