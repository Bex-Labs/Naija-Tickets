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

function payoutStatus(payout: PayoutRecord) {
  switch (payout.status) {
    case 'pending':
      return {
        label: 'Waiting for review',
        explanation: 'This payment is waiting to be reviewed.',
      };
    case 'approved':
      return payout.scheduledAt
        ? {
            label: 'Payment date set',
            explanation: 'A payment date has been recorded below.',
          }
        : {
            label: 'Approved',
            explanation:
              'This payment has been approved. No payment date has been recorded yet.',
          };
    case 'processing':
      return {
        label: 'Being sent',
        explanation:
          'The payment is being processed. It has not been marked as completed yet.',
      };
    case 'paid':
      return {
        label: 'Paid',
        explanation: 'This payment is recorded as completed.',
      };
    case 'failed':
      return {
        label: 'Payment failed',
        explanation:
          'This payment did not complete. Contact support with its reference for help.',
      };
  }
}

function AmountRows({
  rows,
}: {
  rows: { label: string; value: number; total?: boolean }[];
}) {
  return (
    <dl className="mt-4 space-y-3 text-sm">
      {rows.map(({ label, value, total }) => (
        <div
          key={label}
          className={`flex justify-between gap-4 border-b border-[#241b3f]/10 pb-3 ${total ? 'font-black' : ''}`}
        >
          <dt>{label}</dt>
          <dd className="whitespace-nowrap font-bold">{formatAmount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OrganiserPayoutSummary({
  tracking,
}: {
  tracking: OrganiserPayoutTracking;
}) {
  const waiting =
    tracking.scheduledKobo + tracking.approvedKobo + tracking.pendingKobo;
  const cards = [
    {
      label: 'Your ticket earnings',
      amount: tracking.eligibleKobo,
      description:
        'Ticket sales after discounts, refunds and recorded payout fees.',
    },
    {
      label: 'Paid out',
      amount: tracking.paidKobo,
      description: 'Payments recorded as completed.',
      paid: true,
    },
    {
      label: 'Waiting to be paid',
      amount: waiting,
      description: 'Recorded payments still waiting for review or completion.',
    },
    {
      label: 'No payout record yet',
      amount: tracking.unallocatedKobo,
      description:
        tracking.unallocatedKobo < 0
          ? 'Recorded payouts are higher than the earnings shown. Contact support to check the records.'
          : 'Earnings that have not yet been added to a payout record.',
    },
  ];
  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`border p-5 ${card.paid ? 'border-emerald-500/25 bg-emerald-50' : 'border-[#241b3f]/10 bg-white'}`}
          >
            <h2 className="text-sm font-bold">{card.label}</h2>
            <p
              className={`mt-3 break-words text-2xl font-black ${card.paid ? 'text-emerald-800' : ''}`}
            >
              {formatAmount(card.amount)}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-600">
              {card.description}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-3xl text-xs leading-5 text-slate-600">
        These amounts come from recorded sales and payments. They do not show
        your live bank balance. Payments Paystack sends directly to your bank
        may be recorded separately.
      </p>

      <section className="mt-8 border border-[#241b3f]/10 bg-white p-5 sm:p-6">
        <h2 className="text-xl font-black">
          What is happening to the money waiting to be paid?
        </h2>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {[
            {
              label: 'Waiting for review',
              amount: tracking.pendingKobo,
              description: 'Payments waiting for approval.',
            },
            {
              label: 'Payment date set',
              amount: tracking.scheduledKobo,
              description:
                'Payments with a planned payment date. See the dates in your payment history.',
            },
            {
              label: 'Approved or being sent',
              amount: tracking.approvedKobo,
              description:
                'Payments approved or being processed, with no payment date recorded yet.',
            },
          ].map((item) => (
            <div key={item.label} className="border-t border-[#241b3f]/10 pt-4">
              <h3 className="text-sm font-bold">{item.label}</h3>
              <p className="mt-2 text-xl font-black">
                {formatAmount(item.amount)}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <details className="mt-6 border border-[#241b3f]/10 bg-white p-5 sm:p-6">
        <summary className="cursor-pointer text-base font-black">
          See how your earnings are calculated
        </summary>
        <div className="mt-4 max-w-3xl">
          <AmountRows
            rows={[
              {
                label: 'Ticket sales from confirmed payments',
                value: tracking.grossSalesKobo,
              },
              {
                label: 'Minus promo discounts',
                value: -tracking.discountsKobo,
              },
              {
                label: 'Minus completed refunds',
                value: -tracking.refundsKobo,
              },
              {
                label: 'Minus recorded payout fees',
                value: -tracking.payoutFeesKobo,
              },
              {
                label: 'Your ticket earnings',
                value: tracking.eligibleKobo,
                total: true,
              },
              {
                label: 'Minus payments already paid out',
                value: -tracking.paidKobo,
              },
              { label: 'Minus payments waiting to be paid', value: -waiting },
              {
                label: 'Amount with no payout record yet',
                value: tracking.unallocatedKobo,
                total: true,
              },
            ]}
          />
          <p className="mt-4 text-xs leading-5 text-slate-600">
            The extra service fee paid by the buyer is not included in your
            ticket earnings. Failed payouts are not counted as paid or waiting
            to be paid. An amount with no payout record is not a confirmed
            amount ready to withdraw.
          </p>
        </div>
      </details>

      <section className="mt-8">
        <h2 className="text-2xl font-black">Your payment history</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Check the amount, status and date of each payout. If a payment is
          missing or looks wrong, contact support with its reference.
        </p>
        {!tracking.payouts.length ? (
          <div className="mt-4 border border-dashed border-[#241b3f]/15 p-6 text-sm text-slate-600">
            <p className="font-bold text-[#241b3f]">
              No payouts have been recorded yet.
            </p>
            <p className="mt-2">
              Any confirmed ticket sales are still included in your earnings
              above. Your payments will appear here when a payout is recorded.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {tracking.payouts.map((payout) => {
              const status = payoutStatus(payout);
              return (
                <article
                  key={payout.id}
                  className="border border-[#241b3f]/10 bg-white p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-2xl font-black">
                        {formatAmount(payout.amountKobo)}
                      </p>
                      <p className="mt-2 text-sm font-bold">
                        {payout.organiserName}
                      </p>
                    </div>
                    <span
                      className={`inline-block px-3 py-2 text-xs font-bold ${payout.status === 'paid' ? 'bg-emerald-50 text-emerald-800' : payout.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-[#fff3d8] text-[#241b3f]'}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {status.explanation}
                  </p>
                  <dl className="mt-4 grid gap-4 border-t border-[#241b3f]/10 pt-4 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">
                        {payout.status === 'paid'
                          ? 'Paid on'
                          : 'Planned payment date'}
                      </dt>
                      <dd className="mt-1 font-bold">
                        {payout.status === 'paid'
                          ? formatDate(payout.paidAt)
                          : payout.scheduledAt
                            ? formatDate(payout.scheduledAt)
                            : 'No payment date recorded yet'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Ticket sales covered</dt>
                      <dd className="mt-1 font-bold">
                        {formatDate(payout.periodStart)} –{' '}
                        {formatDate(payout.periodEnd)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Payment reference</dt>
                      <dd className="mt-1 break-all font-mono font-bold">
                        {payout.reference}
                      </dd>
                    </div>
                  </dl>
                  <details className="mt-4 border-t border-[#241b3f]/10 pt-4">
                    <summary className="cursor-pointer text-sm font-bold">
                      See how this payment amount was worked out
                    </summary>
                    <AmountRows
                      rows={[
                        {
                          label: 'Ticket sales in this payout',
                          value: payout.grossKobo,
                        },
                        { label: 'Minus fees', value: -payout.feesKobo },
                        { label: 'Minus refunds', value: -payout.refundsKobo },
                        {
                          label: 'Payment amount',
                          value: payout.amountKobo,
                          total: true,
                        },
                      ]}
                    />
                    <p className="mt-3 text-xs text-slate-500">
                      Payout recorded on {formatDate(payout.createdAt)}.
                    </p>
                  </details>
                </article>
              );
            })}
            {tracking.payouts.length === 100 && (
              <p className="text-xs text-slate-600">
                Showing your 100 most recent payouts. The totals above include
                all recorded payouts.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
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
          <p className="eyebrow">Money from your events</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
            Payouts
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            A payout is money paid to you from ticket sales. See what you have
            earned, what has been paid out, and what is still waiting.
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
        tracking && <OrganiserPayoutSummary tracking={tracking} />
      )}
    </div>
  );
}
