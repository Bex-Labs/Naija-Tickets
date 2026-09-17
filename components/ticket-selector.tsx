'use client';

import { Minus, Plus, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TicketType } from '@/lib/events';
import { formatNaira } from '@/lib/events';

export function TicketSelector({
  eventSlug,
  tickets,
  soldOut = false,
}: {
  eventSlug: string;
  tickets: TicketType[];
  soldOut?: boolean;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const total = useMemo(
    () =>
      tickets.reduce(
        (sum, ticket) => sum + ticket.price * (quantities[ticket.name] || 0),
        0,
      ),
    [quantities, tickets],
  );
  const count = Object.values(quantities).reduce(
    (sum, value) => sum + value,
    0,
  );
  const change = (ticket: TicketType, amount: number) =>
    setQuantities((current) => {
      const quantity = current[ticket.name] || 0;
      const minimum = ticket.minPerOrder || 1;
      const maximum = Math.min(ticket.maxPerOrder || 6, ticket.remaining);
      const next =
        amount > 0 && quantity === 0
          ? Math.min(minimum, maximum)
          : amount < 0 && quantity <= minimum
            ? 0
            : Math.max(0, Math.min(maximum, quantity + amount));
      return { ...current, [ticket.name]: next };
    });
  const continueToCheckout = () => {
    const selection = tickets
      .map((ticket, index) => `${index}:${quantities[ticket.name] || 0}`)
      .filter((item) => !item.endsWith(':0'))
      .join(',');
    window.location.href = `/checkout/${encodeURIComponent(eventSlug)}?selection=${encodeURIComponent(selection)}`;
  };

  if (soldOut)
    return (
      <div className="border border-[#241b3f]/10 bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Ticket sales
        </p>
        <h2 className="mt-2 text-2xl font-black text-[#241b3f]">
          This event is sold out
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          All available ticket tiers have reached capacity.
        </p>
      </div>
    );

  return (
    <div
      id="tickets"
      className="border border-[#241b3f]/10 bg-white p-5 text-[#241b3f] shadow-sm sm:p-6"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
        Choose your tickets
      </p>
      <div className="mt-3 divide-y divide-[#241b3f]/10">
        {tickets.map((ticket) => (
          <div key={ticket.name} className="py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black">{ticket.name}</h3>
                <p className="mt-1 text-sm font-bold text-emerald-400">
                  {formatNaira(ticket.price)}
                </p>
                {ticket.description && (
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {ticket.description}
                  </p>
                )}
                {ticket.inclusions && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {ticket.inclusions.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                )}
                {(ticket.status === 'not-on-sale' ||
                  ticket.status === 'sold-out') && (
                  <p className="mt-2 text-xs text-slate-500">
                    {ticket.status === 'not-on-sale'
                      ? ticket.saleState === 'upcoming' && ticket.salesStartAt
                        ? `Sales open ${new Date(ticket.salesStartAt).toLocaleString('en-NG')}`
                        : 'Sales are closed'
                      : 'Sold out'}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center border border-[#241b3f]/10">
                <button
                  aria-label={`Remove one ${ticket.name}`}
                  onClick={() => change(ticket, -1)}
                  className="grid h-11 w-11 place-items-center transition hover:bg-emerald-50"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span
                  className="w-7 text-center text-sm font-black"
                  aria-live="polite"
                >
                  {quantities[ticket.name] || 0}
                </span>
                <button
                  aria-label={`Add one ${ticket.name}`}
                  disabled={
                    ticket.status === 'not-on-sale' ||
                    ticket.status === 'sold-out' ||
                    (quantities[ticket.name] || 0) >=
                      Math.min(ticket.maxPerOrder || 6, ticket.remaining)
                  }
                  onClick={() => change(ticket, 1)}
                  className="grid h-11 w-11 place-items-center bg-emerald-500 text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-[#241b3f]/10 pt-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-slate-600">Total before fees</span>
          <strong className="text-xl">{formatNaira(total)}</strong>
        </div>
        <button
          disabled={!count}
          onClick={continueToCheckout}
          className="w-full bg-emerald-500 px-5 py-3.5 font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-[#241b3f] disabled:text-white disabled:opacity-80"
        >
          {count
            ? `Continue with ${count} ${count === 1 ? 'ticket' : 'tickets'}`
            : 'Select a ticket'}
        </button>
        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4" /> Secure checkout powered by
          Paystack
        </p>
      </div>
    </div>
  );
}
