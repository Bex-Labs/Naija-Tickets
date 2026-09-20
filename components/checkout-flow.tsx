'use client';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  CreditCard,
  ShieldCheck,
  TicketCheck,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNaira } from '@/lib/events';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export type CheckoutLine = {
  ticketTypeId?: string;
  name: string;
  quantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
};

type Attendee = { name: string; email: string; phone: string };

export function CheckoutFlow({
  eventId,
  eventSlug,
  eventTitle,
  eventDate,
  eventVenue,
  lines,
  subtotalKobo,
  feeKobo,
}: {
  eventId?: string;
  eventSlug: string;
  eventTitle: string;
  eventDate: string;
  eventVenue: string;
  lines: CheckoutLine[];
  subtotalKobo: number;
  feeKobo: number;
}) {
  const admissions = useMemo(
    () =>
      lines.flatMap((line) =>
        Array.from({ length: line.quantity }, (_, index) => ({
          key: `${line.ticketTypeId || line.name}-${index}`,
          ticketTypeId: line.ticketTypeId,
          ticketName: line.name,
          number: index + 1,
        })),
      ),
    [lines],
  );
  const [attendees, setAttendees] = useState<Record<string, Attendee>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'reserved'>('idle');
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'starting'>(
    'idle',
  );
  const [error, setError] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [reservation, setReservation] = useState<{
    orderId: string;
    reference: string;
    expiresAt: string;
    subtotalKobo: number;
    feeKobo: number;
    totalKobo: number;
    checkoutToken: string;
    discountKobo: number;
    promoCode: string | null;
  } | null>(null);

  const updateAttendee = (key: string, field: keyof Attendee, value: string) =>
    setAttendees((current) => ({
      ...current,
      [key]: {
        name: current[key]?.name || '',
        email: current[key]?.email || '',
        phone: current[key]?.phone || '',
        [field]: value,
      },
    }));

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setStatus('saving');
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!eventId || lines.some((line) => !line.ticketTypeId)) {
        throw new Error(
          'This event is not available for checkout. Return to the event page and choose an available ticket.',
        );
      }

      const items = lines.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        quantity: line.quantity,
        attendees: admissions
          .filter((admission) => admission.ticketTypeId === line.ticketTypeId)
          .map((admission) => attendees[admission.key]),
      }));
      const firstAttendee = attendees[admissions[0].key];
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (data.session) {
        headers.Authorization = `Bearer ${data.session.access_token}`;
      }
      const response = await fetch('/api/checkout/reservations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          eventId,
          items,
          purchaser: firstAttendee,
          promoCode,
        }),
      });
      const result = (await response.json()) as {
        reservation?: {
          orderId: string;
          reference: string;
          expiresAt: string;
          subtotalKobo: number;
          feeKobo: number;
          totalKobo: number;
          checkoutToken: string;
          discountKobo: number;
          promoCode: string | null;
        };
        error?: string;
      };
      if (!response.ok || !result.reservation) {
        throw new Error(result.error || 'Tickets could not be reserved.');
      }
      setReservation(result.reservation);
      setStatus('reserved');
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Tickets could not be reserved.',
      );
      setStatus('idle');
    }
  };

  const startPayment = async () => {
    if (!reservation) return;
    setPaymentStatus('starting');
    setError('');
    try {
      const response = await fetch('/api/payments/paystack/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: reservation.orderId,
          checkoutToken: reservation.checkoutToken,
        }),
      });
      const result = (await response.json()) as {
        authorizationUrl?: string;
        completed?: boolean;
        statusUrl?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || 'Payment could not be started.');
      }
      if (result.completed && result.statusUrl) {
        window.location.assign(result.statusUrl);
        return;
      }
      if (!result.authorizationUrl) {
        throw new Error('Paystack did not return a checkout page.');
      }
      const checkout = new URL(result.authorizationUrl);
      if (
        checkout.protocol !== 'https:' ||
        checkout.hostname !== 'checkout.paystack.com'
      ) {
        throw new Error('The Paystack checkout address is invalid.');
      }
      window.location.assign(checkout.toString());
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : 'Payment could not be started.',
      );
      setPaymentStatus('idle');
    }
  };

  if (reservation) {
    return (
      <section className="mx-auto max-w-3xl px-5 py-16 md:px-10 md:py-24">
        <div className="border border-emerald-500/30 bg-white p-7 shadow-sm sm:p-10">
          <ol className="grid grid-cols-3 border border-[#241b3f]/10 bg-[#fffaf0] p-4 text-center text-xs font-bold">
            {['Tickets', 'Attendees', 'Payment'].map((label, index) => (
              <li
                key={label}
                className={`flex items-center justify-center gap-2 ${index < 2 ? 'text-emerald-700' : 'text-[#ff6b4a]'}`}
              >
                <span
                  className={`grid h-6 w-6 place-items-center border ${index < 2 ? 'border-emerald-500 bg-emerald-500 text-emerald-950' : 'border-[#ff6b4a]'}`}
                >
                  {index < 2 ? <Check className="h-3.5 w-3.5" /> : 3}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </li>
            ))}
          </ol>
          <span className="mt-8 grid h-14 w-14 place-items-center bg-emerald-500 text-emerald-950">
            <TicketCheck className="h-6 w-6" />
          </span>
          <p className="eyebrow mt-7">Payment</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
            Your tickets are held. Pay securely now.
          </h1>
          <p className="mt-4 leading-7 text-slate-600">
            Reference{' '}
            <strong className="text-[#241b3f]">{reservation.reference}</strong>
          </p>
          <div className="mt-6 flex items-start gap-3 border border-amber-300/50 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
            This reservation expires at{' '}
            {new Date(reservation.expiresAt).toLocaleTimeString('en-NG', {
              hour: 'numeric',
              minute: '2-digit',
            })}
            . Complete payment before this time to keep the selected inventory.
          </div>
          <div className="mt-6 border border-[#241b3f]/10 bg-[#fffaf0] p-5">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Paystack secure checkout
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Card and bank details are entered on Paystack. Naija Tickets
                  never receives your payment credentials.
                </p>
              </div>
              <CreditCard className="h-6 w-6 shrink-0 text-emerald-700" />
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{formatNaira(reservation.subtotalKobo)}</dd>
              </div>
              {reservation.promoCode && (
                <div className="flex justify-between gap-3 text-emerald-700">
                  <dt>Promo {reservation.promoCode}</dt>
                  <dd>−{formatNaira(reservation.discountKobo)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>Service fee</dt>
                <dd>{formatNaira(reservation.feeKobo)}</dd>
              </div>
            </dl>
            <div className="mt-5 flex items-center justify-between border-t border-[#241b3f]/10 pt-5">
              <span className="text-sm text-slate-600">Total to pay</span>
              <strong className="text-2xl">
                {formatNaira(reservation.totalKobo)}
              </strong>
            </div>
            <Button
              type="button"
              disabled={paymentStatus === 'starting'}
              onClick={() => void startPayment()}
              className="mt-5 h-12 w-full bg-[#ff6b4a] font-black text-white hover:bg-[#ee5535]"
            >
              {paymentStatus === 'starting'
                ? 'Opening Paystack...'
                : reservation.totalKobo === 0
                  ? 'Complete free booking'
                  : 'Pay with Paystack'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {error && (
            <output className="mt-4 block border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
              {error}
            </output>
          )}
          <div className="mt-7 flex flex-wrap gap-5">
            <a
              href={`/events/${eventSlug}`}
              className="inline-flex min-h-11 items-center gap-2 font-bold text-emerald-700"
            >
              <ArrowLeft className="h-4 w-4" /> Back to event
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:px-10 lg:grid-cols-[1fr_23rem] lg:py-16"
    >
      <section>
        <ol className="grid grid-cols-3 border border-[#241b3f]/10 bg-white p-4 text-center text-xs font-bold sm:p-5">
          {['Tickets', 'Attendee details', 'Payment'].map((label, index) => (
            <li
              key={label}
              className={`flex items-center justify-center gap-2 ${index === 1 ? 'text-[#ff6b4a]' : index === 2 ? 'text-slate-400' : 'text-emerald-700'}`}
            >
              <span
                className={`grid h-6 w-6 place-items-center border ${index === 0 ? 'border-emerald-500 bg-emerald-500 text-emerald-950' : index === 1 ? 'border-[#ff6b4a]' : 'border-[#241b3f]/15'}`}
              >
                {index === 0 ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </li>
          ))}
        </ol>
        <div className="mt-7">
          <p className="eyebrow">Checkout</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
            Who are the tickets for?
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Add every attendee on this page. These details will be used on the
            tickets after payment is verified.
          </p>
        </div>
        <div className="mt-8 space-y-4">
          {admissions.map((admission, index) => (
            <fieldset
              key={admission.key}
              className="grid gap-5 border border-[#241b3f]/10 bg-white p-5 sm:grid-cols-2 sm:p-6"
            >
              <legend className="px-2 text-sm font-black">
                Attendee {index + 1} · {admission.ticketName}
              </legend>
              <div className="sm:col-span-2">
                <label className="auth-label" htmlFor={`${admission.key}-name`}>
                  Full name
                </label>
                <Input
                  id={`${admission.key}-name`}
                  required
                  minLength={2}
                  autoComplete="name"
                  value={attendees[admission.key]?.name || ''}
                  onChange={(event) =>
                    updateAttendee(admission.key, 'name', event.target.value)
                  }
                  className="auth-input"
                />
              </div>
              <div>
                <label
                  className="auth-label"
                  htmlFor={`${admission.key}-email`}
                >
                  Email
                </label>
                <Input
                  id={`${admission.key}-email`}
                  required
                  type="email"
                  autoComplete="email"
                  value={attendees[admission.key]?.email || ''}
                  onChange={(event) =>
                    updateAttendee(admission.key, 'email', event.target.value)
                  }
                  className="auth-input"
                />
              </div>
              <div>
                <label
                  className="auth-label"
                  htmlFor={`${admission.key}-phone`}
                >
                  Phone
                </label>
                <Input
                  id={`${admission.key}-phone`}
                  required
                  type="tel"
                  autoComplete="tel"
                  value={attendees[admission.key]?.phone || ''}
                  onChange={(event) =>
                    updateAttendee(admission.key, 'phone', event.target.value)
                  }
                  className="auth-input"
                />
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <aside>
        <div className="border border-[#241b3f]/10 bg-white p-6 shadow-sm lg:sticky lg:top-28">
          <p className="eyebrow">Order review</p>
          <h2 className="mt-2 text-xl font-black">{eventTitle}</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {eventDate} · {eventVenue}
          </p>
          <div className="mt-6 divide-y divide-[#241b3f]/10 border-y border-[#241b3f]/10">
            {lines.map((line) => (
              <div
                key={line.name}
                className="flex justify-between gap-4 py-4 text-sm"
              >
                <span>
                  {line.quantity} × {line.name}
                </span>
                <strong>{formatNaira(line.lineTotalKobo)}</strong>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <label className="auth-label" htmlFor="promo-code">
              Promo code (optional)
            </label>
            <Input
              id="promo-code"
              value={promoCode}
              maxLength={32}
              disabled={status !== 'idle'}
              autoComplete="off"
              onChange={(event) =>
                setPromoCode(event.target.value.toUpperCase())
              }
              className="auth-input"
              aria-describedby="promo-code-help"
            />
            <p
              id="promo-code-help"
              className="mt-2 text-xs leading-5 text-slate-500"
            >
              Your code is checked when you reserve tickets. Review the discount
              and final total before payment.
            </p>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="font-bold">{formatNaira(subtotalKobo)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Service fee</dt>
              <dd className="font-bold">{formatNaira(feeKobo)}</dd>
            </div>
            <div className="flex justify-between border-t border-[#241b3f]/10 pt-4 text-lg">
              <dt className="font-black">Total</dt>
              <dd className="font-black">
                {formatNaira(subtotalKobo + feeKobo)}
              </dd>
            </div>
          </dl>
          <Button
            type="submit"
            disabled={status !== 'idle'}
            className="mt-6 h-12 w-full bg-[#ff6b4a] font-black text-white hover:bg-[#ee5535]"
          >
            {status === 'saving' ? 'Reserving tickets...' : 'Reserve tickets'}
            <ArrowRight className="h-4 w-4" />
          </Button>
          {error && (
            <output className="mt-4 block border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
              {error}
            </output>
          )}
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4" /> Totals are calculated on the
            server
          </p>
        </div>
      </aside>
    </form>
  );
}
