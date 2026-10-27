import {
  ArrowRight,
  Code2,
  ExternalLink,
  LockKeyhole,
  Ticket,
  Webhook,
} from 'lucide-react';
const methods = [
  {
    icon: ExternalLink,
    title: 'Buy Tickets link · no coding',
    text: 'Copy a checkout link into your website’s button. No API key or backend needed. Naija Tickets handles payment and tickets.',
    href: '/developers/no-code',
  },
  {
    icon: Ticket,
    title: 'Ticket widget',
    text: 'Embed a public ticket chooser with a small snippet. Keep payment on the trusted checkout.',
    href: '/developers/widget',
  },
  {
    icon: Code2,
    title: 'REST API',
    text: 'Read assigned events and manage permitted order, admission and sales information from your server.',
    href: '/developers/reference',
  },
];
export default function DevelopersPage() {
  return (
    <>
      <section className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <p className="eyebrow">Naija Tickets for developers</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black leading-tight tracking-[-.045em] sm:text-6xl">
            Your audience.
            <br />
            One ticketing engine.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
            Bring event discovery and ticket sales to your website. Naija
            Tickets handles reservations, verified payment, group admissions and
            entry.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/developers/getting-started"
              className="inline-flex min-h-12 items-center gap-3 bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              Start in the sandbox <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/organiser"
              className="inline-flex min-h-12 items-center border border-[#241b3f]/20 px-5 text-sm font-bold"
            >
              Open organiser workspace
            </a>
          </div>
        </div>
        <aside className="min-w-0 border border-[#241b3f]/15 bg-[#241b3f] p-5 text-white sm:p-7">
          <div className="flex items-center gap-2 text-emerald-300">
            <LockKeyhole className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-wider">
              Server first
            </span>
          </div>
          <p className="mt-5 text-xl font-bold leading-8">
            Your website → your backend → Naija Tickets → verified tickets
          </p>
          <pre className="mt-5 whitespace-pre-wrap break-all border-y border-white/15 py-4 font-mono text-xs leading-7 text-emerald-200">
            GET /api/v1/events{'\n'}POST /api/v1/checkout-sessions{'\n'}GET
            /api/v1/checkout-sessions/&#123;id&#125;
          </pre>
          <p className="mt-4 text-xs leading-6 text-violet-200">
            Keep secret keys on your server. Browser redirects and public widget
            IDs are never proof of payment.
          </p>
        </aside>
      </section>
      <section className="mt-10 grid gap-3 md:grid-cols-3">
        {methods.map(({ icon: Icon, title, text, href }) => (
          <article
            key={href}
            className="min-w-0 border border-[#241b3f]/10 bg-white p-5"
          >
            <Icon className="h-6 w-6 text-emerald-700" />
            <h2 className="mt-4 text-xl font-black">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            <a
              href={href}
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800"
            >
              Read the guide <ArrowRight className="h-4 w-4" />
            </a>
          </article>
        ))}
      </section>
      <section className="mt-8 grid gap-4 border-t border-[#241b3f]/10 pt-7 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-emerald-700" />
            <h2 className="text-xl font-black">Know what happened</h2>
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Verify purchase status on your server. Receive signed, durable
            notifications and handle retries safely. The initial Hobby delivery
            schedule is daily, with a bounded queue.
          </p>
          <a
            className="inline-flex min-h-11 items-center text-sm font-bold text-emerald-800"
            href="/developers/webhooks"
          >
            Understand webhook delivery →
          </a>
        </div>
        <div className="border border-amber-300/60 bg-amber-50 p-4">
          <h2 className="font-black">Activation is a separate step</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            This portal describes implemented operations. Each deployment needs
            its own permissions and configuration. Public sandbox purchases,
            receiver delivery and scheduled execution still need acceptance
            evidence.
          </p>
          <a
            href="/developers/readiness"
            className="inline-flex min-h-11 items-center text-sm font-bold text-emerald-900"
          >
            View the readiness checklist →
          </a>
        </div>
      </section>
      <nav
        aria-label="More developer guides"
        className="mt-8 flex flex-wrap gap-5 border-t pt-5 text-sm font-bold text-emerald-800"
      >
        <a className="min-h-11 py-3" href="/developers/authentication">
          Authentication
        </a>
        <a className="min-h-11 py-3" href="/developers/security">
          Security & support
        </a>
        <a className="min-h-11 py-3" href="/developers/faq">
          Frequently asked questions
        </a>
        <a className="min-h-11 py-3" href="/api/v1/openapi.json">
          Download OpenAPI
        </a>
      </nav>
    </>
  );
}
