'use client';

import { useEffect, useState } from 'react';
import type {
  OrganiserPayoutTracking,
  PayoutRecord,
} from '@/lib/organiser-payouts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const formatAmount = (kobo: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(kobo / 100);

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
      }).format(new Date(value))
    : '—';
}

function payoutDate(payout: PayoutRecord) {
  if (payout.status === 'paid') return `Paid ${formatDate(payout.paidAt)}`;
  if (payout.scheduledAt && ['approved', 'processing'].includes(payout.status))
    return `Scheduled ${formatDate(payout.scheduledAt)}`;
  return `Created ${formatDate(payout.createdAt)}`;
}

function payoutStatus(payout: PayoutRecord) {
  if (payout.status === 'approved' && payout.scheduledAt) return 'Scheduled';
  return payout.status[0].toUpperCase() + payout.status.slice(1);
}

export function OrganiserPayouts() {
  const [tracking, setTracking] = useState<OrganiserPayoutTracking | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session)
          throw new Error('Your session has expired. Log in again.');
        const response = await fetch('/api/organiser/payouts', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as OrganiserPayoutTracking & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Payouts could not be loaded.');
        if (!controller.signal.aborted) setTracking(result);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Payouts could not be loaded.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Settlement tracking</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
            Payouts
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            See recorded payouts for your events and reconcile them against
            verified ticket sales.
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
          Refresh payouts
        </button>
      </div>
      {loading ? (
        <output className="mt-8 block text-sm text-slate-600">
          Loading payouts…
        </output>
      ) : error ? (
        <p role="alert" className="mt-8 text-sm text-red-700">
          {error}
        </p>
      ) : (
        tracking && (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ['Eligible after deductions', tracking.eligibleKobo],
                ['Paid', tracking.paidKobo],
                ['Scheduled', tracking.scheduledKobo],
                ['Approved or processing', tracking.approvedKobo],
                ['Pending', tracking.pendingKobo],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border border-[#241b3f]/10 bg-white p-5"
                >
                  <p className="text-sm text-slate-600">{label}</p>
                  <p className="mt-3 text-2xl font-black">
                    {formatAmount(value as number)}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-6 border border-[#241b3f]/10 bg-white p-5 sm:p-6">
              <h2 className="text-lg font-black">How the total reconciles</h2>
              <dl className="mt-4 max-w-2xl space-y-2 text-sm">
                {[
                  ['Verified ticket sales', tracking.grossSalesKobo],
                  ['Promo discounts', -tracking.discountsKobo],
                  ['Completed refunds', -tracking.refundsKobo],
                  ['Recorded payout deductions', -tracking.payoutFeesKobo],
                  ['Eligible after deductions', tracking.eligibleKobo],
                  [
                    'Recorded paid, scheduled, approved, processing and pending payouts',
                    -(
                      tracking.paidKobo +
                      tracking.scheduledKobo +
                      tracking.approvedKobo +
                      tracking.pendingKobo
                    ),
                  ],
                  ['Not assigned to a payout', tracking.unallocatedKobo],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-4 border-b border-[#241b3f]/10 pb-2"
                  >
                    <dt>{label}</dt>
                    <dd className="whitespace-nowrap font-bold">
                      {formatAmount(value as number)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 max-w-3xl text-xs leading-5 text-slate-600">
                Buyer service fees are excluded. Failed payouts are excluded
                from totals. The unassigned amount is an estimate from recorded
                sales and payouts, not a confirmed bank balance; Paystack split
                settlements may be reported separately.
              </p>
            </div>
            <div className="mt-8">
              <h2 className="text-2xl font-black">Payout history</h2>
              {!tracking.payouts.length ? (
                <p className="mt-4 border border-dashed border-[#241b3f]/15 p-6 text-sm text-slate-600">
                  No payouts have been recorded yet. Verified sales appear in
                  the reconciliation above.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {tracking.payouts.map((payout) => (
                    <article
                      key={payout.id}
                      className="grid gap-3 border border-[#241b3f]/10 bg-white p-5 sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <p className="font-black">
                          {payout.organiserName} · {payout.reference}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Sales period {formatDate(payout.periodStart)} –{' '}
                          {formatDate(payout.periodEnd)}
                        </p>
                        <p className="mt-2 text-xs text-slate-600">
                          {payoutDate(payout)}
                        </p>
                      </div>
                      <div className="sm:text-right">
                        <p className="text-xl font-black">
                          {formatAmount(payout.amountKobo)}
                        </p>
                        <span className="mt-2 inline-block bg-[#fff3d8] px-2 py-1 text-xs font-bold text-[#241b3f]">
                          {payoutStatus(payout)}
                        </span>
                      </div>
                    </article>
                  ))}
                  {tracking.payouts.length === 100 && (
                    <p className="text-xs text-slate-600">
                      Showing the 100 most recent payouts. Totals include all
                      recorded payouts.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}
