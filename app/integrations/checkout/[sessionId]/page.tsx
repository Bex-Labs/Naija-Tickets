import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { HostedTicketSelection } from '@/components/hosted-ticket-selection';
import { HostedCheckoutCancel } from '@/components/hosted-checkout-cancel';
import {
  IssuedTicketList,
  PrintTicketsButton,
} from '@/components/issued-ticket';
import { getTicketOrder } from '@/lib/order-tickets.server';
import { getPlatformFeeRule } from '@/lib/checkout';
import {
  getHostedCheckout,
  hostedRecoveryReturn,
  hostedReservation,
  buildIntegrationReturn,
} from '@/lib/integrations/checkout-sessions.server';
import { projectIntegrationTicket } from '@/lib/integrations/events';
import { IntegrationError } from '@/lib/integrations/errors';
export const metadata: Metadata = {
  title: 'Secure checkout | Naija Tickets',
  description: 'Complete your event booking securely.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;
async function model(id: string) {
  let access = '';
  try {
    access =
      (await cookies()).get(`nt_hosted_${id.toLowerCase()}`)?.value ?? '';
    const view = await getHostedCheckout(id, access);
    return {
      view,
      access,
      reserved: await hostedReservation(view),
      feeRule: await getPlatformFeeRule(),
    };
  } catch (cause) {
    return {
      returnUrl: await hostedRecoveryReturn(id, access).catch(() => null),
      error:
        cause instanceof IntegrationError
          ? cause.message
          : 'Checkout is temporarily unavailable. Refresh to try again.',
    };
  }
}
export default async function HostedCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params,
    m = await model(sessionId);
  if ('error' in m)
    return (
      <main className="min-h-screen bg-[#fffaf0] p-5 py-12 text-[#241b3f]">
        <section className="mx-auto max-w-xl rounded-2xl border bg-white p-6">
          <p className="font-bold text-emerald-700">
            Naija Tickets · Secure checkout
          </p>
          <h1 className="mt-5 text-3xl font-black">Checkout unavailable</h1>
          <p className="mt-4 leading-7 text-slate-600">{m.error}</p>
          {m.returnUrl && (
            <a
              href={m.returnUrl}
              rel="noreferrer"
              className="mt-5 inline-flex min-h-11 items-center font-bold text-emerald-800 underline"
            >
              ← Back to organiser
            </a>
          )}
          <p className="mt-4 text-sm text-slate-600">
            Return to the organiser’s website to start again. If you have paid,
            use the ticket link in your confirmation or account instead of
            making another purchase.
          </p>
        </section>
      </main>
    );
  const { view, access, reserved, feeRule } = m;
  const date = new Date(view.event.starts_at).toLocaleString('en-NG', {
    timeZone: view.event.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const ended = ['expired', 'cancelled'].includes(view.session.status);
  const paid = view.session.status === 'paid',
    recorded = ['paid', 'refunded', 'partially_refunded'].includes(
      view.session.status,
    );
  const returnUrl = buildIntegrationReturn({
    url: view.return_url,
    session_id: sessionId,
    status: view.session.status,
    environment: view.session.environment,
  });
  const tickets =
    paid && reserved ? await getTicketOrder(reserved.reference) : null;
  return (
    <main className="payment-status-page min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <header className="no-print border-b border-[#241b3f]/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" width="30" height="30" alt="" />
            <strong>
              Naija Tickets{' '}
              <span className="hidden font-normal text-slate-500 sm:inline">
                · Secure checkout
              </span>
            </strong>
          </div>
          {returnUrl && (
            <a
              href={returnUrl}
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-bold text-emerald-800"
            >
              ← Back to organiser
            </a>
          )}
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {view.session.environment === 'test' && (
          <p className="no-print mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900">
            Test checkout · No real charge or event admission
          </p>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[.9fr_1.1fr]">
          <aside className="no-print overflow-hidden rounded-2xl border border-[#241b3f]/10 bg-white lg:sticky lg:top-6">
            {view.event.image_url && (
              <img
                src={view.event.image_url}
                alt=""
                className="aspect-[16/9] w-full object-cover"
              />
            )}
            <div className="p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                {view.event.organiser.name}
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                {view.event.title}
              </h1>
              <p className="mt-4 text-sm font-semibold leading-6">{date}</p>
              <p className="mt-2 text-sm text-slate-600">
                {view.event.venue_name}, {view.event.city}
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                {view.event.description.replace(/<[^>]*>/g, '').slice(0, 260)}
              </p>
              <p className="mt-5 border-t border-[#241b3f]/10 pt-4 text-xs text-slate-500">
                Tickets and payment are handled securely by Naija Tickets.
              </p>
            </div>
          </aside>
          <div className="no-print overflow-hidden rounded-2xl border border-[#241b3f]/10 bg-white shadow-sm">
            {ended ? (
              <section className="p-5 sm:p-8">
                <p className="text-sm font-bold text-amber-800">
                  Checkout ended
                </p>
                <h2 className="mt-3 text-3xl font-black">
                  This reservation has ended.
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  No new payment can be started here. Return to the organiser to
                  choose tickets again. If you have already paid, check your
                  ticket confirmation or contact support before making another
                  purchase.
                </p>
                {returnUrl && (
                  <a
                    href={returnUrl}
                    rel="noreferrer"
                    className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-emerald-600 px-5 font-bold text-white"
                  >
                    Return to organiser →
                  </a>
                )}
              </section>
            ) : recorded ? (
              <section className="p-5 sm:p-8">
                <p className="text-sm font-bold text-emerald-700">
                  {paid ? 'Payment verified' : 'Booking update'}
                </p>
                <h2 className="mt-3 text-3xl font-black">
                  {paid
                    ? 'Your booking is confirmed.'
                    : `This booking is ${view.session.status.replaceAll('_', ' ')}.`}
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  {paid
                    ? 'Your tickets and group invitations are below. Keep each ticket and private link secure.'
                    : 'Check your order or contact support for details. Refunded admissions cannot be used for entry.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {paid && <PrintTicketsButton />}
                  {returnUrl && (
                    <a
                      href={returnUrl}
                      rel="noreferrer"
                      className="inline-flex min-h-12 items-center rounded-lg bg-emerald-600 px-5 font-bold text-white"
                    >
                      Return to organiser →
                    </a>
                  )}
                </div>
                {paid && tickets?.state !== 'success' && (
                  <p className="mt-5 text-sm text-slate-600">
                    Your paid tickets are being prepared. Refresh this page in a
                    moment.
                  </p>
                )}
              </section>
            ) : (
              <HostedTicketSelection
                sessionId={sessionId}
                access={access}
                event={{
                  id: view.event.id,
                  slug: view.event.slug,
                  title: view.event.title,
                  date,
                  venue: `${view.event.venue_name}, ${view.event.city}`,
                }}
                tiers={view.catalogue.map((row) => ({
                  ...projectIntegrationTicket(row.ticket),
                  max_packages_available: Math.min(20, row.max_packages),
                  remaining_packages_available:
                    row.remaining_packages ?? row.max_packages,
                }))}
                initialLines={view.lines}
                initialReservation={reserved}
                promoCode={view.promo_code}
                feeRule={feeRule}
                customer={view.customer}
              />
            )}
            {!recorded && !ended && (
              <HostedCheckoutCancel sessionId={sessionId} access={access} />
            )}
          </div>
        </div>
        {tickets?.state === 'success' && (
          <IssuedTicketList order={tickets.order} />
        )}
        <p className="no-print mt-6 text-center text-xs text-slate-500">
          Secure checkout powered by Naija Tickets
        </p>
      </section>
    </main>
  );
}
