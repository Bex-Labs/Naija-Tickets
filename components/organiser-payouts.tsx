'use client';

import { useEffect, useState } from 'react';
import { Landmark, RefreshCw } from 'lucide-react';
import type {
  OrganiserPayoutTracking,
  PayoutRecord,
} from '@/lib/organiser-payouts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const amount = (kobo: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(kobo / 100);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
      }).format(new Date(value))
    : 'Not confirmed yet';
function status(payout: PayoutRecord) {
  switch (payout.status) {
    case 'paid':
      return payout.automatic ? 'Sent to your bank' : 'Recorded as paid';
    case 'processing':
      return 'On the way';
    case 'failed':
      return 'Payment failed';
    default:
      return 'Waiting to be sent';
  }
}

export function OrganiserPayoutSummary({
  tracking,
  onOpenSettings,
}: {
  tracking: OrganiserPayoutTracking;
  onOpenSettings?: () => void;
}) {
  const bankConnected = tracking.sync?.banks.some((bank) => bank.enabled);
  const remaining = tracking.eligibleKobo - tracking.paidKobo;
  return (
    <>
      {tracking.sync?.testMode && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Test mode.</strong> Test ticket sales do not send money to a
          bank. Real payout recording starts when live payments are enabled.
        </p>
      )}
      <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#241b3f]/10 bg-white p-4">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div>
            <h2 className="text-sm font-bold">
              {bankConnected
                ? 'Bank account connected'
                : 'Connect a bank for future ticket payments'}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {bankConnected
                ? tracking.sync?.banks
                    .filter((bank) => bank.enabled)
                    .map((bank) => `${bank.name} •••• ${bank.last4}`)
                    .join(' · ')
                : 'Choose your bank in Settings. Payments collected before it was connected need support to arrange payment.'}
            </p>
          </div>
        </div>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="min-h-10 rounded border border-emerald-700/20 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
          >
            {bankConnected ? 'Bank settings' : 'Connect bank'}
          </button>
        )}
      </section>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {[
          {
            label: 'Ticket earnings',
            value: tracking.eligibleKobo,
            description:
              'Your ticket sales, less discounts, completed refunds and confirmed payout fees.',
          },
          {
            label: 'Paid to your bank',
            value: tracking.paidKobo,
            description:
              'Completed payouts. Automatic records are confirmed by Paystack.',
          },
          {
            label: 'Still to receive',
            value: Math.max(0, remaining),
            description:
              'An estimate until all fees and adjustments are confirmed. This is not a scheduled bank payment.',
          },
        ].map((card) => (
          <section
            key={card.label}
            className="rounded-lg border border-[#241b3f]/10 bg-white p-5"
          >
            <h2 className="text-sm font-bold">{card.label}</h2>
            <p className="mt-2 text-2xl font-black text-emerald-800">
              {amount(card.value)}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              {card.description}
            </p>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-600">
        You do not need to enter payouts yourself. We check for bank payouts
        when you open this page and every minute while it stays open. A ticket
        sale only counts as paid out after the bank payout is confirmed.
      </p>
      {tracking.sync?.lastSyncedAt && (
        <p className="mt-1 text-xs text-slate-500">
          Last successful check:{' '}
          {new Date(tracking.sync.lastSyncedAt).toLocaleString('en-NG', {
            timeZone: 'Africa/Lagos',
          })}{' '}
          (Lagos time).
        </p>
      )}
      {(tracking.sync?.needsAttention || remaining < 0) && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          {remaining < 0
            ? 'Refunds or adjustments have changed your earnings after a payout. Contact support to reconcile the difference.'
            : 'Some payouts could not be confirmed yet. We have kept the last confirmed records and will retry automatically. If this continues, contact support.'}
        </p>
      )}
      <details className="mt-5 rounded-lg border border-[#241b3f]/10 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-bold">
          How your earnings are calculated
        </summary>
        <dl className="mt-3 max-w-xl space-y-2 text-sm">
          {[
            ['Confirmed ticket sales', tracking.grossSalesKobo],
            ['Discounts', -tracking.discountsKobo],
            ['Completed refunds', -tracking.refundsKobo],
            ['Confirmed payout fees', -tracking.payoutFeesKobo],
            ['Ticket earnings', tracking.eligibleKobo],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-3">
              <dt>{label}</dt>
              <dd className="font-semibold">{amount(Number(value))}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          The buyer’s extra service fee is not part of your ticket earnings.
          Free tickets do not create bank payouts.
        </p>
      </details>
      <section className="mt-8">
        <h2 className="text-xl font-black">Bank payout history</h2>
        <p className="mt-2 text-sm text-slate-600">
          One row per bank payout. Several ticket sales may be paid together.
        </p>
        {!tracking.payouts.length ? (
          <div className="mt-4 rounded-lg border border-dashed border-[#241b3f]/20 p-5 text-sm text-slate-600">
            <p className="font-bold text-[#241b3f]">No bank payouts yet</p>
            <p className="mt-1">
              {tracking.sync?.testMode
                ? 'No real money is paid out in test mode.'
                : 'Your payout will appear automatically when Paystack creates it. Ticket earnings above do not mean money has already reached your bank.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {tracking.payouts.map((payout) => (
              <details
                key={payout.id}
                className="rounded-lg border border-[#241b3f]/10 bg-white px-4 py-3"
              >
                <summary className="cursor-pointer text-sm">
                  <span className="font-black">
                    {amount(payout.amountKobo)}
                  </span>
                  <span
                    className={`ml-3 font-semibold ${payout.status === 'paid' ? 'text-emerald-800' : payout.status === 'failed' ? 'text-red-700' : 'text-slate-600'}`}
                  >
                    {status(payout)}
                  </span>
                  <span className="ml-3 text-xs text-slate-500">
                    {date(payout.paidAt || payout.scheduledAt)}
                  </span>
                </summary>
                <dl className="mt-3 grid gap-2 border-t border-[#241b3f]/10 pt-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="break-all font-semibold">
                      {payout.reference}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Sales included</dt>
                    <dd>
                      {date(payout.periodStart)} – {date(payout.periodEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Ticket amount</dt>
                    <dd>{amount(payout.grossKobo)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Fees / refunds</dt>
                    <dd>
                      {amount(payout.feesKobo)} / {amount(payout.refundsKobo)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-slate-500">
                  {payout.automatic
                    ? 'Recorded automatically from Paystack. Your bank may take time to display a completed payment.'
                    : 'Previously entered record.'}
                </p>
              </details>
            ))}
          </div>
        )}
        {tracking.payouts.length === 100 && (
          <p className="mt-3 text-xs text-slate-500">
            Showing the latest 100 payouts. Totals include all records.
          </p>
        )}
      </section>
    </>
  );
}

export function OrganiserPayouts({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const [tracking, setTracking] = useState<OrganiserPayoutTracking | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
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
        if (!controller.signal.aborted) {
          setTracking(result);
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Payouts could not be loaded.',
          );
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    const focus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', focus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [reload]);
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Money from your events</p>
          <h1 className="mt-2 text-4xl font-black">Payouts</h1>
          <p className="mt-3 text-sm text-slate-600">
            See what you earned and what has been sent to your bank.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setReload((value) => value + 1);
          }}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking…' : 'Check for updates'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-5 text-sm text-red-700">
          {error}
          {tracking ? ' Showing the last loaded figures.' : ''}
        </p>
      )}
      {tracking ? (
        <OrganiserPayoutSummary
          tracking={tracking}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        loading && (
          <output className="mt-8 block text-sm text-slate-600">
            Checking your payout records…
          </output>
        )
      )}
    </div>
  );
}
