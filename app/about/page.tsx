import type { Metadata } from 'next';
import {
  ArrowRight,
  BadgeCheck,
  HandCoins,
  MapPinned,
  ReceiptText,
  ShieldCheck,
  TicketCheck,
  UsersRound,
} from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { getPlatformFeeRule } from '@/lib/checkout';
import { formatNaira } from '@/lib/events';

export const metadata: Metadata = {
  title: 'About us | Naija Tickets',
  description:
    'Why Naija Tickets exists and how we are building better event experiences across Nigeria.',
};

const values = [
  {
    icon: BadgeCheck,
    title: 'Trust is the product',
    text: 'Clear pricing, verified organisers and straightforward event policies.',
  },
  {
    icon: MapPinned,
    title: 'Nigeria, in full colour',
    text: 'We build for the cities, cultures and communities that make every gathering distinct.',
  },
  {
    icon: UsersRound,
    title: 'Better for both sides',
    text: 'Guests get confidence. Organisers get practical tools and useful numbers.',
  },
];

export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const feeRule = await getPlatformFeeRule();
  const feeDescription =
    feeRule.type === 'percentage'
      ? `${feeRule.basisPoints / 100}% of the ticket subtotal`
      : `${formatNaira(feeRule.fixedKoboPerTicket)} per ticket`;
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="relative overflow-hidden border-b border-[#241b3f]/10">
        <img
          src="/hero-night-stadium.png"
          alt="A stadium audience at a live event"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#241b3f] via-[#241b3f]/90 to-[#241b3f]/45" />
        <div className="relative mx-auto max-w-7xl px-5 py-20 text-white md:px-10 md:py-28">
          <p className="text-xs font-bold uppercase tracking-[.15em] text-[#ffd75e]">
            About Naija Tickets
          </p>
          <h1 className="mt-4 max-w-4xl text-5xl font-black leading-[.98] tracking-[-.055em] sm:text-7xl">
            Built for the moments Nigeria talks about tomorrow.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-violet-100">
            Great events bring people closer. We’re building the trusted
            infrastructure that helps guests discover them and organisers run
            them brilliantly.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-14 md:px-10 md:py-20">
        <div className="grid gap-5 md:grid-cols-3">
          {values.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="border border-[#241b3f]/10 bg-white p-7 shadow-sm"
            >
              <Icon className="h-6 w-6 text-emerald-400" />
              <h2 className="mt-7 text-xl font-black">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
        <section className="mt-16 border-y border-[#241b3f]/10 py-14">
          <p className="eyebrow">Pricing</p>
          <h2 className="mt-3 max-w-3xl text-4xl font-black tracking-[-.04em]">
            Clear before anyone pays.
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-slate-600">
            Organisers choose their ticket prices. Naija Tickets calculates the
            service fee on the server and shows the complete total before the
            buyer opens Paystack.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <article className="border border-[#241b3f]/10 bg-white p-6">
              <ReceiptText className="h-5 w-5 text-emerald-600" />
              <h3 className="mt-5 font-black">For buyers</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Pay the ticket subtotal plus the clearly displayed service fee.
                There are no hidden additions after checkout begins.
              </p>
            </article>
            <article className="border border-[#241b3f]/10 bg-white p-6">
              <HandCoins className="h-5 w-5 text-emerald-600" />
              <h3 className="mt-5 font-black">For organisers</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Create listings without a setup charge. Payouts start with the
                ticket subtotal, then account for refunds, chargebacks and any
                disclosed settlement deductions.
              </p>
            </article>
            <article className="border border-emerald-500/25 bg-emerald-50 p-6">
              <span
                aria-hidden="true"
                className="grid h-6 w-6 place-items-center rounded-full bg-emerald-700 text-sm font-black text-white"
              >
                ₦
              </span>
              <h3 className="mt-5 font-black">Current service fee</h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                The current rule is <strong>{feeDescription}</strong>.
              </p>
            </article>
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">
            Organisers who connect a verified Paystack payout account receive
            their ticket subtotal through split settlement. Naija Tickets
            receives the displayed service fee.
          </p>
        </section>
        <div className="mt-16 grid gap-10 border-t border-[#241b3f]/10 pt-14 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="eyebrow">What we are building</p>
            <h2 className="mt-3 text-4xl font-black tracking-[-.04em]">
              Discovery, ticketing and admission working as one.
            </h2>
          </div>
          <div className="space-y-4 text-slate-600">
            <p className="flex gap-3 leading-7">
              <TicketCheck className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
              Ticket choices that explain exactly what is included and what the
              final cost will be.
            </p>
            <p className="flex gap-3 leading-7">
              <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
              Secure payment verification and fast, atomic QR admission as the
              platform advances.
            </p>
          </div>
        </div>
        <div className="mt-16 border border-emerald-400/25 bg-emerald-400/10 p-8 md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <h2 className="text-2xl font-black">
              Come discover something new.
            </h2>
            <p className="mt-2 text-slate-700">
              Start with events happening across Nigeria.
            </p>
          </div>
          <a
            href="/events"
            className="mt-6 inline-flex items-center gap-2 bg-emerald-500 px-5 py-3 font-bold text-emerald-950 md:mt-0"
          >
            Explore events
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
