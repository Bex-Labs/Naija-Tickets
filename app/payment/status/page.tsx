import type { Metadata } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  RotateCcw,
} from 'lucide-react';
import {
  IssuedTicketList,
  PrintTicketsButton,
} from '@/components/issued-ticket';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import type { TicketOrderLookup } from '@/lib/order-ticket-access';
import { getTicketOrder } from '@/lib/order-tickets.server';

export const metadata: Metadata = {
  title: 'Your tickets | Naija Tickets',
  description: 'View and save your verified Naija Tickets order.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  searchParams: Promise<{
    reference?: string;
    paymentReference?: string;
    delivery?: string;
  }>;
};

const states = {
  paid_without_tickets: {
    eyebrow: 'Payment confirmed',
    title: 'Your tickets are being prepared.',
    body: 'Your order is paid, but the issued ticket records are not available yet. Refresh this page in a moment.',
    icon: Clock3,
    iconClass: 'bg-emerald-100 text-emerald-800',
  },
  expired: {
    eyebrow: 'Payment needs attention',
    title: 'The reservation expired.',
    body: 'The inventory hold ended before payment confirmation, so no ticket codes are available. Contact support with your payment details for a review.',
    icon: AlertTriangle,
    iconClass: 'bg-amber-300 text-amber-950',
  },
  refunded: {
    eyebrow: 'Refund confirmed',
    title: 'These tickets were refunded.',
    body: 'This order has been fully refunded, so its ticket codes are no longer valid for entry.',
    icon: RotateCcw,
    iconClass: 'bg-violet-200 text-violet-950',
  },
  pending: {
    eyebrow: 'Verification in progress',
    title: 'We are checking your payment.',
    body: 'Paystack has not returned a final successful status yet. Wait a moment, then check again.',
    icon: Clock3,
    iconClass: 'bg-violet-200 text-violet-950',
  },
  failed: {
    eyebrow: 'Payment not completed',
    title: 'No tickets were issued.',
    body: 'The payment was not successful or did not match the reserved order. No private ticket codes can be displayed.',
    icon: AlertTriangle,
    iconClass: 'bg-red-100 text-red-700',
  },
  invalid: {
    eyebrow: 'Ticket link unavailable',
    title: 'We could not open this order.',
    body: 'This private ticket link is missing, invalid or no longer available. Return to the event catalogue or contact support if you completed payment.',
    icon: AlertTriangle,
    iconClass: 'bg-red-100 text-red-700',
  },
} as const;

function emptyState(lookup: TicketOrderLookup) {
  if (lookup.state === 'not_found') return states.invalid;
  if (lookup.state === 'success') return null;
  return states[lookup.state];
}

export default async function PaymentStatusPage({ searchParams }: Props) {
  const {
    reference = '',
    paymentReference = '',
    delivery = '',
  } = await searchParams;
  let lookup: TicketOrderLookup;
  try {
    lookup = await getTicketOrder(reference);
  } catch (error) {
    console.error('Unable to load the ticket order', error);
    lookup = { state: 'invalid' };
  }

  if (lookup.state === 'success') {
    return (
      <main className="payment-status-page min-h-screen bg-[#fffaf0] text-[#241b3f]">
        <SiteHeader />
        <section className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-18">
          <div className="no-print flex flex-col justify-between gap-6 border border-emerald-500/25 bg-white p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end">
            <div>
              <span className="grid h-12 w-12 place-items-center bg-emerald-500 text-emerald-950">
                <CheckCircle2 className="h-6 w-6" />
              </span>
              <p className="eyebrow mt-6">Payment confirmed</p>
              <h1 className="mt-2 text-3xl font-black tracking-[-.04em] sm:text-4xl">
                {lookup.order.groups?.length
                  ? 'Your group booking is confirmed.'
                  : 'Your tickets are ready.'}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                {lookup.order.groups?.length
                  ? 'Share your group registration link below. Each member claims their own admission and receives a unique QR code. Your admissions are already reserved.'
                  : 'Show each QR code at the entrance. Keep this private link and every ticket code secure.'}
              </p>
              <p className="mt-2 text-sm font-semibold text-emerald-700">
                {['sent', 'already_sent'].includes(delivery)
                  ? 'A ticket confirmation was also sent to the purchase email address.'
                  : 'Your tickets are available here even while email delivery is pending.'}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <PrintTicketsButton />
              <a
                href="/events"
                className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#241b3f]/15 px-5 font-black"
              >
                Browse events <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
          <IssuedTicketList order={lookup.order} />
        </section>
        <SiteFooter />
      </main>
    );
  }

  const state = emptyState(lookup) || states.invalid;
  const Icon = state.icon;
  const canRetry =
    (lookup.state === 'pending' || lookup.state === 'paid_without_tickets') &&
    paymentReference;

  return (
    <main className="payment-status-page min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="mx-auto max-w-3xl px-5 py-16 md:px-10 md:py-24">
        <div className="border border-[#241b3f]/10 bg-white p-7 shadow-sm sm:p-10">
          <span
            className={`grid h-14 w-14 place-items-center ${state.iconClass}`}
          >
            <Icon className="h-7 w-7" />
          </span>
          <p className="eyebrow mt-7">{state.eyebrow}</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-.04em] sm:text-5xl">
            {state.title}
          </h1>
          <p className="mt-4 max-w-xl leading-7 text-slate-600">{state.body}</p>
          {'reference' in lookup && lookup.reference && (
            <div className="mt-7 border border-[#241b3f]/10 bg-[#fffaf0] p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Order reference
              </p>
              <p className="mt-2 break-all font-mono text-sm font-bold">
                {lookup.reference}
              </p>
            </div>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {canRetry && (
              <a
                href={`/payment/callback?reference=${encodeURIComponent(paymentReference)}`}
                className="inline-flex min-h-12 items-center justify-center gap-2 bg-[#ff6b4a] px-5 font-black text-white"
              >
                <RotateCcw className="h-4 w-4" /> Check payment again
              </a>
            )}
            <a
              href="/events"
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#241b3f]/15 px-5 font-black"
            >
              Browse events <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
