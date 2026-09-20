'use client';

import { useEffect, useState } from 'react';
import { formatNaira } from '@/lib/events';
import type { OrganiserSalesAnalytics } from '@/lib/organiser-analytics';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function OrganiserSalesAnalytics() {
  const [analytics, setAnalytics] = useState<OrganiserSalesAnalytics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session)
          throw new Error('Your session has expired. Log in again.');
        const response = await fetch('/api/organiser/analytics', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as OrganiserSalesAnalytics & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            result.error || 'Sales analytics could not be loaded.',
          );
        if (!controller.signal.aborted) setAnalytics(result);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Sales analytics could not be loaded.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);
  const refresh = () => {
    setLoading(true);
    setError('');
    setReload((value) => value + 1);
  };
  const maxRevenue = Math.max(
    1,
    ...(analytics?.categories.map((category) => category.revenueKobo) || []),
  );
  return (
    <section className="mt-10" aria-labelledby="sales-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="sales-heading" className="text-2xl font-black">
            Sales performance
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Paid bookings with verified payments. Ticket revenue excludes
            service fees and reflects discounts and completed refunds.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="min-h-11 px-3 text-sm font-bold text-emerald-800 underline disabled:opacity-50"
        >
          Refresh sales
        </button>
      </div>
      {loading ? (
        <output className="mt-6 block text-sm text-slate-600">
          Loading sales analytics…
        </output>
      ) : error ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      ) : (
        analytics && (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {[
                ['Tickets sold', analytics.ticketsSold.toLocaleString('en-NG')],
                ['Ticket revenue', formatNaira(analytics.revenueKobo)],
                [
                  'Remaining inventory',
                  analytics.inventoryRemaining.toLocaleString('en-NG'),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border border-[#241b3f]/10 bg-white p-5"
                >
                  <p className="text-sm text-slate-600">{label}</p>
                  <p className="mt-3 text-3xl font-black">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-600">
              Remaining inventory excludes live holds and inactive ticket types.{' '}
              {analytics.inventoryReserved.toLocaleString('en-NG')} ticket
              {analytics.inventoryReserved === 1 ? '' : 's'} currently held.
            </p>
            <div className="mt-8 grid gap-6 xl:grid-cols-2">
              <div className="border border-[#241b3f]/10 bg-white p-5 sm:p-6">
                <h3 className="text-lg font-black">Sales by event category</h3>
                {!analytics.categories.length || !analytics.ticketsSold ? (
                  <p className="mt-5 text-sm text-slate-600">
                    No verified ticket sales yet.
                  </p>
                ) : (
                  <div className="mt-5 space-y-5">
                    {analytics.categories
                      .filter(
                        (category) =>
                          category.ticketsSold > 0 || category.revenueKobo > 0,
                      )
                      .map((category) => (
                        <div key={category.category}>
                          <div className="flex justify-between gap-3 text-sm">
                            <span className="font-bold">
                              {category.category}
                            </span>
                            <span>
                              {category.ticketsSold.toLocaleString('en-NG')}{' '}
                              sold · {formatNaira(category.revenueKobo)}
                            </span>
                          </div>
                          <div className="mt-2 h-2 bg-[#fff3d8]">
                            <div
                              className="h-full bg-emerald-500"
                              style={{
                                width: `${Math.max(2, (category.revenueKobo / maxRevenue) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div className="border border-[#241b3f]/10 bg-white p-5 sm:p-6">
                <h3 className="text-lg font-black">By event</h3>
                {!analytics.events.length ? (
                  <p className="mt-5 text-sm text-slate-600">
                    Create an event to see its performance.
                  </p>
                ) : (
                  <div className="mt-4 max-h-80 divide-y divide-[#241b3f]/10 overflow-y-auto">
                    {analytics.events.map((event) => (
                      <div
                        key={event.eventId}
                        className="grid grid-cols-[1fr_auto] gap-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-bold">{event.title}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {event.category} · {event.status}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">
                            {formatNaira(event.revenueKobo)}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {event.ticketsSold} sold ·{' '}
                            {event.inventoryRemaining} remaining
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
