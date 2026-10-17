import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { CheckoutFlow } from '@/components/checkout-flow';
import { HostedCheckoutCancel } from '@/components/hosted-checkout-cancel';
import { SiteHeader, SiteFooter } from '@/components/site-header';
import { calculatePlatformFee, getPlatformFeeRule } from '@/lib/checkout';
import {
  getHostedCheckout,
  hostedReservation,
} from '@/lib/integrations/checkout-sessions.server';
import { IntegrationError } from '@/lib/integrations/errors';
export const metadata: Metadata = {
  title: 'Secure checkout | Naija Tickets',
  description: 'Complete your booking securely with Naija Tickets.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;
async function checkoutModel(sessionId: string) {
  try {
    const access =
      (await cookies()).get(`nt_hosted_${sessionId.toLowerCase()}`)?.value ??
      '';
    const view = await getHostedCheckout(sessionId, access),
      reserved = await hostedReservation(view);
    if (['expired', 'cancelled'].includes(view.session.status))
      throw new IntegrationError(
        410,
        'CHECKOUT_EXPIRED',
        'This checkout has expired or been cancelled. Start again from the original website.',
      );
    const subtotal = view.lines.reduce(
      (sum, line) => sum + line.lineTotalKobo,
      0,
    );
    const fee = calculatePlatformFee(
      await getPlatformFeeRule(),
      subtotal,
      view.lines.reduce((sum, line) => sum + line.quantity, 0),
    );
    const date = new Date(view.event.starts_at).toLocaleString('en-NG', {
      timeZone: view.event.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return { view, reserved, subtotal, fee, date, access };
  } catch (cause) {
    return {
      error:
        cause instanceof IntegrationError
          ? cause.message
          : 'This checkout is temporarily unavailable. Please try again.',
    };
  }
}
export default async function HostedCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params,
    model = await checkoutModel(sessionId);
  if ('error' in model)
    return (
      <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
        <SiteHeader />
        <section className="mx-auto max-w-2xl px-5 py-12">
          <h1 className="text-3xl font-black">Checkout unavailable</h1>
          <p className="mt-4 leading-7 text-slate-600">{model.error}</p>
          <a
            href="/events"
            className="mt-6 inline-flex min-h-11 items-center bg-emerald-500 px-5 font-bold"
          >
            Browse events
          </a>
        </section>
        <SiteFooter />
      </main>
    );
  const { view, reserved, subtotal, fee, date, access } = model;
  if (
    reserved &&
    ['paid', 'refunded', 'partially_refunded'].includes(view.session.status)
  )
    return (
      <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
        <SiteHeader />
        <section className="mx-auto max-w-2xl px-5 py-12">
          <h1 className="text-3xl font-black">Your booking is recorded.</h1>
          <p className="mt-3 text-sm text-slate-600">
            View your verified order and individual tickets below.
          </p>
          <a
            href={`/payment/status?reference=${encodeURIComponent(reserved.reference)}`}
            className="mt-6 inline-flex min-h-11 items-center bg-emerald-500 px-5 font-bold"
          >
            View my tickets
          </a>
        </section>
        <SiteFooter />
      </main>
    );
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      {view.session.environment === 'test' && (
        <p className="mx-auto max-w-7xl px-5 pt-5 text-sm font-bold text-amber-800">
          Sandbox booking — no live payment or admission.
        </p>
      )}
      <CheckoutFlow
        eventId={view.event.id}
        eventSlug={view.event.slug}
        eventTitle={view.event.title}
        eventDate={date}
        eventVenue={`${view.event.venue_name}, ${view.event.city}`}
        lines={view.lines}
        subtotalKobo={subtotal}
        feeKobo={fee}
        hostedCheckout={{
          sessionId: view.session.id,
          access,
          promoCode: view.promo_code,
        }}
        initialReservation={reserved}
      />
      <HostedCheckoutCancel sessionId={view.session.id} access={access} />
      <SiteFooter />
    </main>
  );
}
