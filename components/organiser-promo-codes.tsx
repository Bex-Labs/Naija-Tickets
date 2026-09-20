'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrganiserEvent } from '@/lib/organiser-types';
import type { PromoCode } from '@/lib/promo-codes';
import { formatNaira } from '@/lib/events';

async function promoRequest(body?: unknown) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error('Your session has expired. Log in again.');
  const response = await fetch('/api/organiser/promo-codes', {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = (await response.json()) as {
    promoCodes?: PromoCode[];
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error || 'Unable to manage promo codes.');
  return result;
}

export function OrganiserPromoCodes({ events }: { events: OrganiserEvent[] }) {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [eventId, setEventId] = useState('');
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [scope, setScope] = useState('all');
  const [ticketTypeIds, setTicketTypeIds] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const selectedEvent = events.find(
    (event) => event.id === (eventId || events[0]?.id),
  );

  useEffect(() => {
    let active = true;
    void promoRequest()
      .then((result) => {
        if (active) setCodes(result.promoCodes || []);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load promo codes.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEvent || !event.currentTarget.reportValidity()) return;
    setError('');
    setNotice('');
    if (scope === 'selected' && !ticketTypeIds.length) {
      setError('Select at least one ticket type.');
      return;
    }
    setSaving(true);
    try {
      await promoRequest({
        eventId: selectedEvent.id,
        code,
        discountType,
        discountValue,
        startsAt: new Date(`${startsAt}:00+01:00`).toISOString(),
        endsAt: new Date(`${endsAt}:00+01:00`).toISOString(),
        usageLimit: Number(usageLimit),
        ticketTypeIds: scope === 'all' ? [] : ticketTypeIds,
      });
      setNotice(`Promo code ${code.trim().toUpperCase()} created.`);
      setCode('');
      setDiscountValue('');
      setUsageLimit('');
      setLoading(true);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to create promo code.',
      );
    } finally {
      setSaving(false);
    }
  };
  const inputClass =
    'mt-2 min-h-11 w-full border border-[#241b3f]/20 bg-white px-3 text-sm';
  return (
    <div className="animate-rise">
      <p className="eyebrow">Event offers</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
        Promo codes
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Create an offer for an event or selected ticket types. Each booking uses
        the code once. Pending reservations hold a use for up to 10 minutes;
        expired reservations release it. Completed bookings keep their use,
        including refunds.
      </p>
      {!events.length ? (
        <p className="mt-8">Create an event before adding a promo code.</p>
      ) : (
        <form
          onSubmit={submit}
          className="mt-8 border border-[#241b3f]/10 bg-white p-5 sm:p-6"
        >
          <fieldset disabled={saving} className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-5 text-xl font-black">
              Create promo code
            </legend>
            <label className="text-sm font-bold">
              Event
              <select
                className={inputClass}
                value={selectedEvent?.id || ''}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setTicketTypeIds([]);
                }}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              Code
              <input
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_\-]{3,32}"
                className={inputClass}
                placeholder="EARLY20"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                3–32 letters, numbers, hyphens or underscores.
              </span>
            </label>
            <label className="text-sm font-bold">
              Discount type
              <select
                className={inputClass}
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
              >
                <option value="percentage">
                  Percentage off each eligible ticket
                </option>
                <option value="fixed">
                  Fixed naira off each eligible ticket
                </option>
              </select>
            </label>
            <label className="text-sm font-bold">
              {discountType === 'percentage'
                ? 'Discount (%)'
                : 'Discount per ticket (₦)'}
              <input
                required
                type="number"
                min="0.01"
                max={discountType === 'percentage' ? '100' : '1000000'}
                step="0.01"
                className={inputClass}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </label>
            <label className="text-sm font-bold">
              Valid from (WAT)
              <input
                required
                type="datetime-local"
                className={inputClass}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="text-sm font-bold">
              Valid until (WAT)
              <input
                required
                type="datetime-local"
                min={startsAt || undefined}
                className={inputClass}
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
            <label className="text-sm font-bold">
              Maximum bookings
              <input
                required
                type="number"
                min="1"
                max="1000000"
                step="1"
                className={inputClass}
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
              />
            </label>
            <label className="text-sm font-bold">
              Applicable tickets
              <select
                className={inputClass}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="all">All ticket types in this event</option>
                <option value="selected">Selected ticket types</option>
              </select>
            </label>
            {scope === 'selected' && (
              <fieldset className="space-y-2 sm:col-span-2">
                <legend className="mb-2 text-sm font-bold">
                  Choose eligible ticket types
                </legend>
                {selectedEvent?.ticketTypes
                  .filter((ticket) => ticket.id)
                  .map((ticket) => (
                    <label
                      key={ticket.id}
                      className="flex min-h-11 items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={ticketTypeIds.includes(ticket.id!)}
                        onChange={(e) =>
                          setTicketTypeIds((current) =>
                            e.target.checked
                              ? [...current, ticket.id!]
                              : current.filter((id) => id !== ticket.id),
                          )
                        }
                      />
                      {ticket.name}
                    </label>
                  ))}
              </fieldset>
            )}
            <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
              Discounts apply to the current ticket price, including early bird
              prices, and cannot exceed that price. Percentage service fees use
              the discounted subtotal; fixed service fees remain payable. One
              code per booking.
            </p>
            <button
              type="submit"
              className="min-h-11 bg-emerald-500 px-5 text-sm font-black text-emerald-950 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create promo code'}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-4 block text-sm text-emerald-700">
          {notice}
        </output>
      )}
      <div className="mt-8 flex items-center justify-between gap-4">
        <h2 className="text-xl font-black">Your promo codes</h2>
        <button
          type="button"
          className="min-h-11 px-3 text-sm font-bold underline"
          disabled={loading}
          onClick={() => {
            setError('');
            setLoading(true);
            setReload((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <output className="mt-4 block text-sm">Loading promo codes…</output>
      ) : !codes.length ? (
        <p className="mt-4 text-sm text-slate-600">No promo codes to show.</p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {codes.map((promo) => {
            const event = events.find((item) => item.id === promo.event_id);
            return (
              <article
                key={promo.id}
                className="border border-[#241b3f]/10 bg-white p-5"
              >
                <h3 className="font-mono text-lg font-black">{promo.code}</h3>
                <p className="mt-1 text-sm font-bold">
                  {event?.title || 'Event'}
                </p>
                <p className="mt-3 text-sm">
                  {promo.discount_type === 'percentage'
                    ? `${promo.discount_value / 100}%`
                    : formatNaira(promo.discount_value)}{' '}
                  off each eligible ticket · Limit: {promo.usage_limit} bookings
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {promo.ticket_type_ids.length
                    ? promo.ticket_type_ids
                        .map(
                          (id) =>
                            event?.ticketTypes.find(
                              (ticket) => ticket.id === id,
                            )?.name || 'Removed ticket type',
                        )
                        .join(', ')
                    : 'All ticket types'}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {new Date(promo.starts_at).toLocaleString('en-GB', {
                    timeZone: 'Africa/Lagos',
                  })}{' '}
                  –{' '}
                  {new Date(promo.ends_at).toLocaleString('en-GB', {
                    timeZone: 'Africa/Lagos',
                  })}{' '}
                  WAT
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
