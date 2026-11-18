'use client';
import { useState, type SyntheticEvent } from 'react';
import { CheckoutFlow, type CheckoutLine } from './checkout-flow';
import { calculatePlatformFee, type PlatformFeeRule } from '@/lib/platform-fee';
import { formatNaira } from '@/lib/events';
import type { CheckoutReservation } from '@/lib/checkout-service';
export type HostedTier = {
  id: string;
  name: string;
  description: string | null;
  price_kobo: number;
  admissions_per_ticket: number;
  min_packages_per_order: number;
  max_packages_per_order: number;
  sale_status: string;
  max_packages_available: number;
  remaining_packages_available: number;
};
export function HostedTicketSelection({
  sessionId,
  access,
  event,
  tiers,
  initialLines,
  initialReservation,
  promoCode,
  feeRule,
  customer,
}: {
  sessionId: string;
  access: string;
  event: {
    id: string;
    slug: string;
    title: string;
    date: string;
    venue: string;
  };
  tiers: HostedTier[];
  initialLines: CheckoutLine[];
  initialReservation: CheckoutReservation | null;
  promoCode: string | null;
  feeRule: PlatformFeeRule;
  customer: { name?: string; email?: string; phone?: string };
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialLines.map((line) => [line.ticketTypeId!, line.quantity]),
    ),
  );
  const [locked, setLocked] = useState(Boolean(initialReservation));
  const [promo, setPromo] = useState(promoCode ?? ''),
    [stage, setStage] = useState(initialReservation ? 'details' : 'tickets'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lines = initialReservation
    ? initialLines
    : tiers
        .filter((t) => quantities[t.id] > 0)
        .map((t) => ({
          ticketTypeId: t.id,
          name: t.name,
          quantity: quantities[t.id],
          admissionsPerTicket: t.admissions_per_ticket,
          unitPriceKobo: t.price_kobo,
          lineTotalKobo: t.price_kobo * quantities[t.id],
        }));
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalKobo, 0),
    packages = lines.reduce((sum, line) => sum + line.quantity, 0),
    admissions = lines.reduce(
      (sum, line) => sum + line.quantity * (line.admissionsPerTicket || 1),
      0,
    ),
    fee = calculatePlatformFee(feeRule, subtotal, packages);
  async function next(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!packages || admissions > 400) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/integrations/checkout/${sessionId}/selection`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access,
            items: lines.map((line) => ({
              ticket_type_id: line.ticketTypeId,
              quantity: line.quantity,
            })),
            promo_code: promo,
          }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Tickets could not be selected.');
      setStage('details');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Tickets could not be selected.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (stage === 'details')
    return (
      <div>
        {!locked && (
          <button
            className="mx-4 mt-4 min-h-11 text-sm font-bold text-emerald-800 underline"
            onClick={() => setStage('tickets')}
          >
            ← Change ticket selection
          </button>
        )}
        <CheckoutFlow
          key={lines.map((l) => `${l.ticketTypeId}:${l.quantity}`).join(',')}
          standalone
          eventId={event.id}
          eventSlug={event.slug}
          eventTitle={event.title}
          eventDate={event.date}
          eventVenue={event.venue}
          lines={lines}
          subtotalKobo={subtotal}
          feeKobo={fee}
          hostedCheckout={{ sessionId, access, promoCode: promo || null }}
          initialReservation={initialReservation}
          initialCustomer={customer}
          onReserved={() => setLocked(true)}
        />
      </div>
    );
  return (
    <form onSubmit={(e) => void next(e)} className="p-4 sm:p-6">
      <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
        1 · Choose tickets
      </p>
      <h2 className="mt-2 text-2xl font-black">Make it a date.</h2>
      <div className="mt-5 divide-y divide-[#241b3f]/10">
        {tiers.map((t) => {
          const max = Math.max(
              0,
              Math.min(20, t.max_packages_per_order, t.max_packages_available),
            ),
            open = t.sale_status === 'open' && max >= t.min_packages_per_order;
          return (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-4 py-5"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-black">{t.name}</h3>
                {t.description && (
                  <p className="mt-1 text-sm text-slate-600">{t.description}</p>
                )}
                <p className="mt-2 text-sm font-bold">
                  {formatNaira(t.price_kobo)}
                  {t.admissions_per_ticket > 1 && (
                    <span className="font-normal text-slate-500">
                      {' '}
                      · admits {t.admissions_per_ticket}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {open
                    ? `${t.remaining_packages_available} packages left · ${t.min_packages_per_order}–${max} per order`
                    : t.sale_status === 'sold_out'
                      ? 'Sold out'
                      : 'Currently unavailable'}
                </p>
              </div>
              <div>
                <label className="sr-only" htmlFor={`qty-${t.id}`}>
                  Quantity for {t.name}
                </label>
                <select
                  id={`qty-${t.id}`}
                  className="auth-input min-w-20 bg-white"
                  disabled={!open || busy}
                  value={quantities[t.id] || 0}
                  onChange={(e) =>
                    setQuantities({
                      ...quantities,
                      [t.id]: Number(e.target.value),
                    })
                  }
                >
                  <option value="0">0</option>
                  {open &&
                    Array.from(
                      { length: max - t.min_packages_per_order + 1 },
                      (_, i) => i + t.min_packages_per_order,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
      {!tiers.length && (
        <p className="py-5 text-slate-600">No tickets are on sale right now.</p>
      )}
      <div className="mt-4 rounded-xl bg-[#eef5ef] p-4">
        <label className="auth-label" htmlFor="hosted-promo">
          Promo code (optional)
        </label>
        <input
          id="hosted-promo"
          className="auth-input w-full bg-white"
          maxLength={32}
          value={promo}
          onChange={(e) => setPromo(e.target.value.toUpperCase())}
        />
        <p className="mt-2 text-xs text-slate-500">
          Discounts are checked when you reserve. Review the final total before
          paying.
        </p>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Tickets · {admissions} admissions</dt>
            <dd>{packages ? formatNaira(subtotal) : 'Select tickets'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Service fee</dt>
            <dd>{packages ? formatNaira(fee) : '—'}</dd>
          </div>
          <div className="flex justify-between border-t border-emerald-800/15 pt-3 text-lg font-black">
            <dt>Total before any discount</dt>
            <dd>{packages ? formatNaira(subtotal + fee) : '—'}</dd>
          </div>
        </dl>
      </div>
      {admissions > 400 && (
        <p className="mt-3 text-sm text-red-800">
          Choose no more than 400 admissions.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        disabled={!packages || admissions > 400 || busy}
        className="mt-5 min-h-12 w-full rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-50"
      >
        {busy ? 'Checking tickets…' : 'Continue to your details →'}
      </button>
      <p className="mt-3 text-center text-xs text-slate-500">
        Guest checkout · Secure payment · No account needed
      </p>
    </form>
  );
}
