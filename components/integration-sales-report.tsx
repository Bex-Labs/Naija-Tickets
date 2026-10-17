'use client';
import type { HostedReport } from '@/lib/integrations/hosted-report';
import { formatNaira } from '@/lib/events';
const labels: Record<string, string> = {
  direct: 'Naija Tickets',
  hosted_api: 'Hosted API',
  hosted_link: 'Hosted link',
  legacy_widget: 'Legacy widget',
};
export function IntegrationSalesReport({ report }: { report: HostedReport }) {
  return (
    <section className="mt-6 min-w-0">
      <h3 className="text-lg font-black">Where your sales come from</h3>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Last 30 days · Verified orders for this application’s assigned events.
        Revenue is ticket value after discounts, before refunds. Fees and
        confirmed refunds are shown separately. Payout calculations are
        unchanged.
      </p>
      <div className="mt-3 space-y-2">
        {report.channels.map((c) => (
          <div
            key={c.source}
            className="grid gap-2 rounded-lg border border-[#241b3f]/10 p-3 text-xs sm:grid-cols-3"
          >
            <strong>{labels[c.source]}</strong>
            <span>
              {c.purchases} purchases · {c.admissions} admissions
            </span>
            <span>
              Tickets {formatNaira(c.ticketRevenueKobo)}
              <br />
              Fees {formatNaira(c.feesKobo)} · Refunds{' '}
              {formatNaira(c.refundedKobo)}
            </span>
          </div>
        ))}
        {!report.channels.length && (
          <p className="py-3 text-sm text-slate-500">
            No verified purchases in this period.
          </p>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {report.funnel.map((f) => (
          <p key={f.source} className="text-xs leading-5 text-slate-600">
            <strong>{labels[f.source]}:</strong> {f.created} checkouts started ·{' '}
            {f.completed} completed · {f.expired} expired · {f.cancelled}{' '}
            cancelled · {f.conversionPercent}% completed
          </p>
        ))}
      </div>
      <h4 className="mt-5 font-bold">Recent checkout sessions</h4>
      <p className="mt-1 text-xs text-slate-500">
        Up to 50 sessions from the last 30 days. Expand a row for its order and
        event IDs.
      </p>
      <div className="mt-3 divide-y border-y border-[#241b3f]/10">
        {report.sessions.map((s) => (
          <details key={s.id} className="py-2 text-xs">
            <summary className="cursor-pointer leading-6">
              <strong>{labels[s.source]}</strong> ·{' '}
              {new Date(s.createdAt).toLocaleDateString('en-NG')} ·{' '}
              {s.status.replaceAll('_', ' ')} ·{' '}
              {s.totalKobo === null ? 'Not reserved' : formatNaira(s.totalKobo)}
            </summary>
            <dl className="mt-2 grid gap-1 break-all bg-slate-50 p-2 text-slate-600">
              <div>Session: {s.id}</div>
              <div>Event: {s.eventId}</div>
              <div>
                Order: {s.orderId ?? 'Not reserved'} · {s.admissions} admissions
              </div>
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}
