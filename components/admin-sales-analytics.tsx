'use client';

import { useEffect, useState } from 'react';
import { formatNaira } from '@/lib/events';
import type { AdminSalesAnalytics } from '@/lib/admin-analytics';

export function AdminSalesOverview() {
  const [analytics, setAnalytics] = useState<AdminSalesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/analytics', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as AdminSalesAnalytics & {
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
    ...(analytics?.categories.map((item) => item.revenueKobo) || []),
  );
  return (
    <section className="mt-10" aria-labelledby="admin-sales-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="admin-sales-heading" className="text-2xl font-black">
            Platform sales
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Paid bookings with verified payments across all events. Ticket
            revenue reflects discounts and completed refunds, excluding service
            fees.
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 px-3 text-sm font-bold text-emerald-800 underline disabled:opacity-50"
          disabled={loading}
          onClick={refresh}
        >
          Refresh sales
        </button>
      </div>
      {loading ? (
        <output className="mt-6 block text-sm text-slate-600">
          Loading platform sales…
        </output>
      ) : error ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      ) : (
        analytics && (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ['Tickets sold', analytics.ticketsSold.toLocaleString('en-NG')],
                ['Ticket revenue', formatNaira(analytics.ticketRevenueKobo)],
                [
                  'Verified bookings',
                  analytics.bookings.toLocaleString('en-NG'),
                ],
                [
                  'Service fees charged',
                  formatNaira(analytics.serviceFeesKobo),
                ],
                [
                  'Remaining inventory',
                  analytics.inventoryRemaining.toLocaleString('en-NG'),
                ],
                ['Total events', analytics.eventCount.toLocaleString('en-NG')],
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
              Service fees are shown before any fee refunds. Remaining inventory
              excludes inactive ticket types and live holds;{' '}
              {analytics.inventoryReserved.toLocaleString('en-NG')} ticket
              {analytics.inventoryReserved === 1 ? '' : 's'} currently held.
            </p>
            <div className="mt-8 grid gap-6 xl:grid-cols-2">
              <div className="border border-[#241b3f]/10 bg-white p-5 sm:p-6">
                <h3 className="text-lg font-black">Sales by event category</h3>
                {!analytics.categories.length ? (
                  <p className="mt-5 text-sm text-slate-600">
                    No verified ticket sales yet.
                  </p>
                ) : (
                  <div className="mt-5 space-y-5">
                    {analytics.categories.map((item) => (
                      <div key={item.category}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="font-bold">{item.category}</span>
                          <span>
                            {item.ticketsSold.toLocaleString('en-NG')} sold ·{' '}
                            {formatNaira(item.revenueKobo)}
                          </span>
                        </div>
                        <div className="mt-2 h-2 bg-[#fff3d8]">
                          <div
                            className="h-full bg-emerald-500"
                            style={{
                              width: `${Math.max(2, (item.revenueKobo / maxRevenue) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border border-[#241b3f]/10 bg-white p-5 sm:p-6">
                <h3 className="text-lg font-black">
                  Top events by ticket revenue
                </h3>
                {!analytics.topEvents.length ? (
                  <p className="mt-5 text-sm text-slate-600">
                    No verified bookings yet.
                  </p>
                ) : (
                  <div className="mt-4 max-h-80 divide-y divide-[#241b3f]/10 overflow-y-auto">
                    {analytics.topEvents.map((event) => (
                      <div
                        key={event.eventId}
                        className="flex items-center justify-between gap-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-bold">{event.title}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {event.organiser} · {event.category}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-bold">
                            {formatNaira(event.revenueKobo)}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {event.ticketsSold} sold
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
