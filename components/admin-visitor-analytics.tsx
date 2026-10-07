'use client';

import { useEffect, useState } from 'react';
import { UsersRound } from 'lucide-react';
import type { AdminVisitorAnalytics } from '@/lib/site-visitors';

export function AdminVisitorOverview() {
  const [analytics, setAnalytics] = useState<AdminVisitorAnalytics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/visitors', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as AdminVisitorAnalytics & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Visitors could not be loaded.');
        if (!controller.signal.aborted) setAnalytics(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Visitors could not be loaded.',
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  return (
    <section className="mt-8" aria-labelledby="admin-visitors-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="admin-visitors-heading"
            className="flex items-center gap-2 text-2xl font-black"
          >
            <UsersRound
              className="h-5 w-5 text-emerald-700"
              aria-hidden="true"
            />
            Website visitors
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Unique browsers visiting the app. Repeat visits count once in each
            period.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError('');
            setReload((value) => value + 1);
          }}
          className="min-h-11 px-3 text-sm font-bold text-emerald-800 underline disabled:opacity-50"
        >
          Refresh visitors
        </button>
      </div>
      {loading ? (
        <output className="mt-5 block text-sm text-slate-600">
          Loading visitors…
        </output>
      ) : error ? (
        <p role="alert" className="mt-5 text-sm text-red-700">
          {error}
        </p>
      ) : analytics ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-4">
            {(
              [
                ['Total visitors', analytics.totalVisitors],
                ['Today', analytics.visitorsToday],
                ['Last 30 days', analytics.visitorsLast30Days],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="border border-[#241b3f]/10 bg-white p-4 sm:p-5"
              >
                <p className="text-sm text-slate-600">{label}</p>
                <p className="mt-2 text-3xl font-black text-emerald-800">
                  {value.toLocaleString('en-NG')}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600">
            {analytics.trackingStartedAt
              ? `Counting since ${new Date(analytics.trackingStartedAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })}. `
              : 'Counts begin when the first visitor is recorded. '}
            Days use Nigerian time. Admin, organiser and entry pages are
            excluded. Visitors with tracking disabled are excluded; a different
            browser or cleared browser storage may count as a new visitor.
          </p>
        </>
      ) : null}
    </section>
  );
}
