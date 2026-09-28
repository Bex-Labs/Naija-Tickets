'use client';

import { Printer } from 'lucide-react';
import { TicketArtwork } from '@/components/ticket-artwork';
import type { PaidTicketOrderView } from '@/lib/order-ticket-access';
import { formatNaira } from '@/lib/events';
import { GroupBookingCard } from '@/components/group-booking-card';
import { TicketShareButton } from '@/components/ticket-share-button';

function eventTiming(order: PaidTicketOrderView) {
  const startsAt = new Date(order.event.startsAt);
  return {
    date: new Intl.DateTimeFormat('en-NG', {
      timeZone: order.event.timezone,
      dateStyle: 'full',
    }).format(startsAt),
    time: new Intl.DateTimeFormat('en-NG', {
      timeZone: order.event.timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(startsAt),
  };
}

export function PrintTicketsButton() {
  return (
    <button
      type="button"
      onClick={() => {
        delete document.body.dataset.printTicket;
        window.print();
      }}
      className="no-print inline-flex min-h-12 items-center justify-center gap-2 bg-[#241b3f] px-5 font-black text-white transition hover:bg-[#35294f]"
    >
      <Printer className="h-4 w-4" /> Print or save tickets
    </button>
  );
}

export function IssuedTicketList({
  order,
  hideOrderReference = false,
}: {
  order: PaidTicketOrderView;
  hideOrderReference?: boolean;
}) {
  const timing = eventTiming(order);

  return (
    <div
      className="ticket-print-sheet mt-9 space-y-7"
      aria-live="polite"
      data-ticket-count={order.tickets.length}
    >
      {order.groups?.map((booking) => (
        <GroupBookingCard key={booking.id} booking={booking} />
      ))}
      {order.tickets.map((ticket, index) => (
        <article
          key={ticket.id}
          className="issued-ticket-record"
          aria-label={`Ticket for ${ticket.attendeeName}`}
        >
          <div className="issued-ticket" data-print-ticket>
            <TicketArtwork
              id={`issued-artwork-${ticket.id}`}
              details={{
                eventTitle: order.event.title,
                category: order.event.category,
                presenter: order.event.presenterLine,
                date: timing.date,
                time: `${timing.time} ${order.event.timezoneLabel}`,
                venue: `${order.event.venue}, ${order.event.city}`,
                address: order.event.address,
                ticketType: ticket.ticketType,
                attendeeName: ticket.attendeeName,
                price: formatNaira(ticket.unitPriceKobo),
                priceLabel:
                  (ticket.admissionsPerTicket || 1) > 1
                    ? 'Group package price'
                    : 'Unit price',
                displayCode: ticket.displayCode,
                orderReference: hideOrderReference
                  ? undefined
                  : order.reference,
                position: `Ticket ${index + 1} of ${order.tickets.length}`,
              }}
            />
          </div>
          <TicketShareButton
            artworkId={`issued-artwork-${ticket.id}`}
            eventTitle={order.event.title}
            attendeeName={ticket.attendeeName}
            displayCode={ticket.displayCode}
            canShare={ticket.status === 'valid'}
          />
        </article>
      ))}
    </div>
  );
}
