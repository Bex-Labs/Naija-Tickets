import type { Metadata } from 'next';
import {
  ArrowRight,
  CircleHelp,
  CreditCard,
  ShieldCheck,
  TicketCheck,
  UsersRound,
} from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Help centre | Naija Tickets',
  description:
    'Find help with bookings, tickets, group passes, payments and organising events on Naija Tickets.',
};

const quickLinks = [
  {
    icon: TicketCheck,
    title: 'Find your tickets',
    text: 'Open your account to view your tickets, bookings and payment history.',
    href: '/account',
    action: 'Go to my tickets',
  },
  {
    icon: UsersRound,
    title: 'Manage a group pass',
    text: 'See claimed members and share your group registration link again.',
    href: '/account',
    action: 'Open my bookings',
  },
  {
    icon: ShieldCheck,
    title: 'Organise an event',
    text: 'Manage events, attendees, verification and payouts in your workspace.',
    href: '/organiser',
    action: 'Open organiser workspace',
  },
];

const topics = [
  {
    id: 'tickets',
    icon: TicketCheck,
    title: 'Tickets and entry',
    questions: [
      {
        question: 'Where can I find my tickets?',
        answer:
          'If you bought tickets while signed in, open My tickets in your account. Your payment confirmation page also shows tickets after the payment has been verified. If you received a confirmation email, its private link opens the order too.',
      },
      {
        question: 'How do I use my QR code at the event?',
        answer:
          'Show the QR code on your phone or on a printed ticket to the entry team. Each admission has its own code, and a valid code can only be checked in once.',
      },
    ],
  },
  {
    id: 'payments',
    icon: CreditCard,
    title: 'Payments and refunds',
    questions: [
      {
        question: 'I paid, but my ticket is not showing. What should I do?',
        answer:
          'Open the private confirmation link from your payment flow or email, and allow a moment for verification to finish. Signed-in buyers can also check My tickets. Keep your order reference and payment details if the ticket still does not appear.',
      },
      {
        question: 'Can I get a refund?',
        answer:
          'Refund eligibility depends on the event policy and payment status. Approved refunds are tracked against the order. A fully refunded ticket can no longer be used for entry.',
      },
    ],
  },
  {
    id: 'groups',
    icon: UsersRound,
    title: 'Group tickets',
    questions: [
      {
        question: 'How do group members get their tickets?',
        answer:
          'After payment, open the group booking in My tickets. You can enter each member’s details yourself or share the registration link so members claim their own reserved admissions. Each claimed member gets an individual ticket and QR code.',
      },
      {
        question: 'Can one person claim more than one group place?',
        answer:
          'The same email address or phone number cannot claim multiple places in the same group. The link stops accepting claims when all reserved places are filled.',
      },
    ],
  },
  {
    id: 'organisers',
    icon: CircleHelp,
    title: 'Organiser accounts',
    questions: [
      {
        question: 'Where do I manage my event and attendees?',
        answer:
          'Sign in and open the organiser workspace. Create or edit events there, review ticket sales, view registered attendees and open event entry tools.',
      },
      {
        question: 'Where can I check verification and payouts?',
        answer:
          'Open Settings in the organiser workspace to submit verification details or manage your payout account. The Payouts section shows recorded amounts and their status.',
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="overflow-hidden bg-[#241b3f] px-5 py-10 text-white md:px-10 md:py-24">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-300">
            Naija Tickets help
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-.05em] sm:text-6xl">
            Get back to the good part.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-violet-100">
            Quick answers for bookings, entry, group passes and running an
            event.
          </p>
          <nav aria-label="Help topics" className="mt-9 flex flex-wrap gap-2">
            {topics.map(({ id, title }) => (
              <a
                key={id}
                href={`#${id}`}
                className="inline-flex min-h-11 items-center border border-white/25 px-4 text-sm font-bold text-white transition hover:border-emerald-300 hover:text-emerald-300"
              >
                {title}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-10 md:px-10 md:py-20">
        <div className="grid gap-4 lg:grid-cols-3">
          {quickLinks.map(({ icon: Icon, title, text, href, action }) => (
            <article
              key={title}
              className="flex flex-col border border-[#241b3f]/10 bg-white p-6 shadow-sm"
            >
              <Icon className="h-7 w-7 text-emerald-600" aria-hidden="true" />
              <h2 className="mt-6 text-xl font-black">{title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                {text}
              </p>
              <a
                href={href}
                className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800 hover:text-emerald-600"
              >
                {action} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>

        <div className="mt-10 max-w-3xl md:mt-16">
          <p className="eyebrow">Frequently asked questions</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            What do you need to know?
          </h2>
        </div>
        <div className="mt-7 grid gap-7 md:mt-10 md:gap-10 lg:grid-cols-2">
          {topics.map(({ id, icon: Icon, title, questions }) => (
            <section key={id} id={id} className="scroll-mt-24">
              <h3 className="flex items-center gap-3 border-b border-[#241b3f]/15 pb-4 text-xl font-black">
                <Icon className="h-6 w-6 text-emerald-600" aria-hidden="true" />
                {title}
              </h3>
              <div className="divide-y divide-[#241b3f]/10">
                {questions.map(({ question, answer }) => (
                  <details key={question} className="group py-5">
                    <summary className="cursor-pointer list-none pr-8 font-bold marker:hidden [&::-webkit-details-marker]:hidden">
                      {question}
                      <span
                        className="float-right text-xl leading-none text-emerald-700 group-open:rotate-45"
                        aria-hidden="true"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
                      {answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section className="mt-10 border border-emerald-500/25 bg-emerald-50 p-5 sm:p-8 md:mt-16">
          <h2 className="text-2xl font-black">Need help with a specific booking?</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">
            Check your ticket and payment history first. If a payment or entry
            issue remains, keep the order reference, event name and email used at
            checkout together. For schedule or venue questions, review the event
            page and the organiser’s public details there.
          </p>
          <a
            href="/account"
            className="mt-6 inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-5 text-sm font-black text-emerald-950 hover:bg-emerald-400"
          >
            Check my tickets <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </section>
      </section>
      <SiteFooter />
    </main>
  );
}
