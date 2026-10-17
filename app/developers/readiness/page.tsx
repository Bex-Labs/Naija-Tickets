export const metadata = { title: 'Deployment readiness' };
const checks = [
  [
    'Isolated resources',
    'Separate sandbox Supabase/deployment and Paystack test key; exact resource binding and different live reference. No production customer copy.',
  ],
  [
    'Migration rehearsal',
    'Apply all ordered migrations to a disposable database first. Review only pending files against the intended sandbox. Never reset or blindly replay existing remote migrations.',
  ],
  [
    'Secrets and origins',
    'Dedicated versioned signing/encryption/cron material, exact APP_URL and partner origins. Keep keys server-side and out of bundles/logs. Rotate exposed values.',
  ],
  [
    'Verified online purchase',
    'External site → sandbox checkout → Paystack TEST → verified session/order/admissions → partner return. Repeat free/group/cancel/expiry and response-loss retries.',
  ],
  [
    'Tickets and delegated entry',
    'Claim each group member through the existing flow. Verify independent QR codes and one-time entry, refunds, revoked creator/event grants and foreign application denial.',
  ],
  [
    'Durable notifications',
    'Persistent public inbox with signature verification, ID/body deduplication, secret rotation and crash recovery. Observe actual Hobby cron and manual retry; daily bounded delivery has no real-time SLA.',
  ],
  [
    'Browser and operational review',
    'Mobile/desktop/keyboard, host CSS/CSP, blocked third-party cookies, Safari/physical device QR/camera, realistic throughput/backlog and support recovery.',
  ],
  [
    'Rollout and recovery',
    'Start with minimum scopes/flags in sandbox. Keep live disabled until acceptance is recorded. Suspend abusive apps, monitor errors/exhausted deliveries and preserve verified receipts/history.',
  ],
];
export default function ReadinessPage() {
  return (
    <article className="max-w-4xl">
      <p className="eyebrow">Operator checklist</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
        Deploy with evidence.
      </h1>
      <p className="mt-4 text-sm leading-7 text-slate-600">
        A passing build proves compilation. The checks below establish whether a
        specific deployment can safely accept an external purchase. This page
        contains no private environment values and does not certify production
        readiness.
      </p>
      <div className="mt-6 border border-amber-300/60 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
        Current acceptance still needs the public sandbox purchase/return,
        durable receiver and observed scheduled delivery. Email is deferred.
        Local database, protocol and browser fixtures do not close those gates.
      </div>
      <ol className="mt-6 divide-y border-y border-[#241b3f]/15">
        {checks.map(([title, body], i) => (
          <li key={title} className="flex gap-4 py-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-emerald-100 text-sm font-black text-emerald-950">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h2 className="font-black">{title}</h2>
              <p className="mt-1 text-sm leading-7 text-slate-600">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <h2 className="mt-7 text-xl font-black">Useful local checks</h2>
      <pre className="mt-3 whitespace-pre-wrap break-words bg-[#241b3f] p-4 text-xs leading-7 text-emerald-100 [overflow-wrap:anywhere]">
        {
          'npm test\nnpm run lint\nnpx tsc --noEmit --incremental false\nVERCEL=1 NITRO_PRESET=vercel npm run build\nnpm run integrations:readiness'
        }
      </pre>
      <p className="mt-3 text-sm leading-7 text-slate-600">
        The readiness command prints check names and fixed outcomes, not
        secrets. A disabled feature is reported as disabled, not accepted.
        Operator runbooks and evidence live in the repository’s docs folder.
      </p>
      <div className="mt-5 flex flex-wrap gap-5 text-sm font-bold text-emerald-800">
        <a className="min-h-11 py-3" href="/developers/sandbox">
          Sandbox guide →
        </a>
        <a className="min-h-11 py-3" href="/developers/security">
          Security and support →
        </a>
      </div>
    </article>
  );
}
