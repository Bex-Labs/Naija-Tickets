import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { CheckoutFlow, type CheckoutLine } from '@/components/checkout-flow';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { calculatePlatformFee, getPlatformFeeRule } from '@/lib/checkout';
import { ticketPrice, type TicketType } from '@/lib/events';
import { getPublishedEventBySlug } from '@/lib/supabase/public-events-server';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ selection?: string }>;
};

export const metadata: Metadata = {
  title: 'Checkout | Naija Tickets',
  description: 'Review your event tickets and attendee details.',
};
export const dynamic = 'force-dynamic';

function selectedLines(ticketTypes: TicketType[], selection = '') {
  let availableAdmissions = 400;
  const quantities = new Map<number, number>();
  for (const pair of selection.split(',')) {
    const [rawIndex, rawQuantity] = pair.split(':');
    const index = Number(rawIndex);
    const quantity = Number(rawQuantity);
    if (
      Number.isSafeInteger(index) &&
      Number.isSafeInteger(quantity) &&
      index >= 0 &&
      index < ticketTypes.length &&
      quantity > 0
    ) {
      quantities.set(
        index,
        Math.min(
          quantity,
          ticketTypes[index].remaining,
          ticketTypes[index].maxPerOrder || 6,
        ),
      );
    }
  }
  return Array.from(quantities.entries())
    .filter(
      ([index, quantity]) => quantity >= (ticketTypes[index].minPerOrder || 1),
    )
    .flatMap(([index, requestedQuantity]): CheckoutLine[] => {
      const ticket = ticketTypes[index];
      const size = ticket.admissionsPerTicket || 1;
      const quantity = Math.min(
        requestedQuantity,
        Math.floor(availableAdmissions / size),
      );
      if (quantity < (ticket.minPerOrder || 1)) return [];
      availableAdmissions -= quantity * size;
      const unitPriceKobo = ticketPrice(ticket);
      return [
        {
          ticketTypeId: ticket.id,
          name: ticket.name,
          quantity,
          admissionsPerTicket: ticket.admissionsPerTicket || 1,
          unitPriceKobo,
          lineTotalKobo: unitPriceKobo * quantity,
        },
      ];
    });
}

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { selection } = await searchParams;
  const event = await getPublishedEventBySlug(slug);
  const lines = event ? selectedLines(event.ticketTypes, selection) : [];

  if (!event || !lines.length) {
    return (
      <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
        <SiteHeader />
        <section className="mx-auto max-w-2xl px-5 py-24 text-center">
          <h1 className="text-4xl font-black tracking-[-.04em]">
            Choose tickets before checkout
          </h1>
          <p className="mt-4 leading-7 text-slate-600">
            Return to the event, select at least one available ticket and then
            continue to checkout.
          </p>
          <a
            href={event ? `/events/${event.slug}` : '/events'}
            className="mt-7 inline-flex items-center gap-2 bg-emerald-500 px-5 py-3 font-bold text-emerald-950"
          >
            <ArrowLeft className="h-4 w-4" /> Back to events
          </a>
        </section>
        <SiteFooter />
      </main>
    );
  }

  const subtotalKobo = lines.reduce(
    (total, line) => total + line.lineTotalKobo,
    0,
  );
  const ticketQuantity = lines.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const feeRule = await getPlatformFeeRule();
  const feeKobo = calculatePlatformFee(feeRule, subtotalKobo, ticketQuantity);
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <CheckoutFlow
        eventId={event.id}
        eventSlug={event.slug}
        eventTitle={event.title}
        eventDate={`${event.displayDate}, ${event.time}`}
        eventVenue={`${event.venue}, ${event.city}`}
        lines={lines}
        subtotalKobo={subtotalKobo}
        feeKobo={feeKobo}
      />
      <SiteFooter />
    </main>
  );
}
