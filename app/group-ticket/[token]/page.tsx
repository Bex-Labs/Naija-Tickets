import type { Metadata } from 'next';
import { SiteHeader, SiteFooter } from '@/components/site-header';
import { IssuedTicketList } from '@/components/issued-ticket';
import { GROUP_TOKEN_PATTERN } from '@/lib/group-bookings';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import type { PaidTicketOrderView } from '@/lib/order-ticket-access';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: 'Your claimed ticket | Naija Tickets',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function ClaimedTicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let order: PaidTicketOrderView | null = null;
  if (GROUP_TOKEN_PATTERN.test(token)) {
    const client = getSupabaseAdminClient();
    const { data: ticket, error } = await client
      .from('tickets')
      .select(
        'id,order_item_id,event_id,attendee_name,display_code,status,issued_at',
      )
      .eq('claim_access_token', token)
      .neq('claim_state', 'UNCLAIMED')
      .maybeSingle();
    if (error) throw error;
    if (ticket) {
      const [
        { data: event, error: eventError },
        { data: item, error: itemError },
      ] = await Promise.all([
        client
          .from('events')
          .select(
            'title,presenter_line,starts_at,timezone,timezone_label,venue_name,city,address',
          )
          .eq('id', ticket.event_id)
          .single(),
        client
          .from('order_items')
          .select(
            'order_id,unit_price_kobo,admissions_per_ticket,ticket_types(name)',
          )
          .eq('id', ticket.order_item_id)
          .single(),
      ]);
      if (eventError || itemError) throw eventError || itemError;
      const { data: purchase, error: purchaseError } = await client
        .from('orders')
        .select('status')
        .eq('id', item!.order_id)
        .single();
      const { count: verified, error: paymentError } = await client
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', item!.order_id)
        .eq('status', 'verified');
      if (purchaseError || paymentError) throw purchaseError || paymentError;
      if (
        event &&
        item &&
        verified &&
        ['paid', 'partially_refunded'].includes(purchase!.status) &&
        ['valid', 'used'].includes(ticket.status)
      ) {
        const tier = Array.isArray(item.ticket_types)
          ? item.ticket_types[0]
          : item.ticket_types;
        order = {
          reference: ticket.display_code,
          currency: 'NGN',
          event: {
            title: event.title,
            presenterLine: event.presenter_line || '',
            category: 'Group ticket',
            startsAt: event.starts_at,
            timezone: event.timezone || 'Africa/Lagos',
            timezoneLabel: event.timezone_label || 'WAT',
            venue: event.venue_name,
            city: event.city,
            address: event.address,
          },
          tickets: [
            {
              id: ticket.id,
              orderItemId: ticket.order_item_id,
              attendeeName: ticket.attendee_name,
              displayCode: ticket.display_code,
              status: ticket.status,
              issuedAt: ticket.issued_at,
              ticketType: tier?.name || 'Group ticket',
              unitPriceKobo: Number(item.unit_price_kobo),
              admissionsPerTicket: item.admissions_per_ticket,
            },
          ],
        };
      }
    }
  }
  return (
    <main className="payment-status-page min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-5 py-12 md:px-10">
        <p className="eyebrow">Group admission</p>
        <h1 className="mt-3 text-3xl font-black">
          {order
            ? order.tickets[0].status === 'used'
              ? 'Your ticket has been checked in.'
              : 'Your ticket is claimed.'
            : 'This ticket is unavailable.'}
        </h1>
        {order ? (
          <>
            <p className="mt-4 text-sm text-slate-600">
              Save your ticket and keep this private link. Your QR code admits
              one person, once.
            </p>
            <IssuedTicketList order={order} hideOrderReference />
          </>
        ) : (
          <p className="mt-4 text-slate-600">
            The link may be invalid or this ticket may have been cancelled or
            refunded.
          </p>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
