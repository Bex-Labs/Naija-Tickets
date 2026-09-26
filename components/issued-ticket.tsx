'use client';

import {
  CalendarDays,
  Clock3,
  MapPin,
  Printer,
  Ticket,
  UserRound,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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
      onClick={() => window.print()}
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
          className="issued-ticket"
          aria-labelledby={`ticket-title-${ticket.id}`}
          data-print-ticket
        >
          <div className="issued-ticket__main">
            <div className="issued-ticket__brand-row">
              <div className="flex items-center gap-2.5 text-lg sm:text-xl">
                <span className="grid h-9 w-9 place-items-center bg-emerald-500 text-emerald-950">
                  <Ticket className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="brand-wordmark">Naija Tickets</span>
              </div>
              <div className="min-w-0 text-left sm:text-right">
                <p className="text-xs font-black uppercase tracking-[.2em] text-[#ff5c42]">
                  {order.event.category}
                </p>
                <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                  {order.event.presenterLine}
                </p>
              </div>
            </div>

            <div className="issued-ticket__art" aria-hidden="true">
              <Ticket />
            </div>

            <h2
              id={`ticket-title-${ticket.id}`}
              className="issued-ticket__title"
            >
              {order.event.title}
            </h2>

            <dl className="issued-ticket__details">
              <div>
                <CalendarDays aria-hidden="true" />
                <span>
                  <dt>Date</dt>
                  <dd>{timing.date}</dd>
                </span>
              </div>
              <div>
                <Clock3 aria-hidden="true" />
                <span>
                  <dt>Start time</dt>
                  <dd>
                    {timing.time} {order.event.timezoneLabel}
                  </dd>
                </span>
              </div>
              <div>
                <MapPin aria-hidden="true" />
                <span>
                  <dt>Venue</dt>
                  <dd>
                    {order.event.venue}, {order.event.city}
                  </dd>
                </span>
              </div>
            </dl>

            <p className="issued-ticket__address">{order.event.address}</p>

            <div className="issued-ticket__admission">
              <div>
                <span>
                  Ticket {index + 1} of {order.tickets.length}
                </span>
                <strong>{ticket.ticketType}</strong>
              </div>
              <div>
                <span>Attendee</span>
                <strong className="flex items-center gap-2">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  {ticket.attendeeName}
                </strong>
              </div>
              <div>
                <span>
                  {(ticket.admissionsPerTicket || 1) > 1
                    ? 'Group package price'
                    : 'Unit price'}
                </span>
                <strong>{formatNaira(ticket.unitPriceKobo)}</strong>
              </div>
            </div>
          </div>

          <aside className="issued-ticket__stub" aria-label="Entry code">
            <div className="flex items-center gap-2 text-white">
              <span className="grid h-8 w-8 place-items-center bg-[#fffaf0] text-[#241b3f]">
                <Ticket className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="brand-wordmark text-lg">Naija Tickets</span>
            </div>
            <div>
              <p className="mt-8 text-2xl font-black uppercase tracking-[.08em] text-white">
                Admit one
              </p>
              <p className="mt-3 border-y border-white/55 py-3 text-xs font-black uppercase tracking-[.24em] text-emerald-50">
                {ticket.ticketType}
              </p>
            </div>
            <div className="issued-ticket__qr">
              <QRCodeSVG
                id={`issued-qr-${ticket.id}`}
                value={ticket.displayCode}
                title={`Entry QR code for ${ticket.attendeeName}`}
                size={148}
                level="M"
                bgColor="#fffaf0"
                fgColor="#17112f"
              />
              <p className="mt-3 break-all font-mono text-sm font-black tracking-[.08em] text-[#241b3f]">
                {ticket.displayCode}
              </p>
            </div>
            {ticket.status === 'valid' && (
              <TicketShareButton
                qrId={`issued-qr-${ticket.id}`}
                eventTitle={order.event.title}
                eventDate={`${timing.date}, ${timing.time} ${order.event.timezoneLabel}`}
                venue={`${order.event.venue}, ${order.event.city}`}
                attendeeName={ticket.attendeeName}
                ticketType={ticket.ticketType}
                displayCode={ticket.displayCode}
              />
            )}
            {!hideOrderReference && (
              <div className="mt-5 text-[10px] font-bold uppercase tracking-[.13em] text-emerald-50">
                <span className="block">Order reference</span>
                <span className="mt-1 block break-all font-mono normal-case tracking-normal">
                  {order.reference}
                </span>
              </div>
            )}
          </aside>
        </article>
      ))}
    </div>
  );
}
