import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Terms of Service | Naija Tickets',
  description: 'Terms for using Naija Tickets.',
};

const sections = [
  {
    title: 'Using Naija Tickets',
    body: 'You must provide accurate account and checkout information, keep your login details secure and use the platform only for lawful event and ticket activity. You are responsible for activity performed through your account.',
  },
  {
    title: 'Tickets and payments',
    body: 'Ticket availability and prices are confirmed during checkout. A ticket is issued only after payment is verified or a valid free booking is completed. Payment processing may be provided by an external payment provider.',
  },
  {
    title: 'Events and entry',
    body: 'Organisers are responsible for their event information, operation and entry rules. Guests must follow the event policies shown before purchase and present a valid, unused ticket at entry.',
  },
  {
    title: 'Cancellations and refunds',
    body: 'Refund eligibility depends on the event policy, payment status and applicable law. Approved refunds may take additional time to appear through the original payment method.',
  },
  {
    title: 'Organiser responsibilities',
    body: 'Organisers must publish accurate information, honour valid tickets, protect attendee data and comply with applicable laws. Naija Tickets may review, reject or remove listings that are misleading, unsafe or unlawful.',
  },
  {
    title: 'Platform availability',
    body: 'We work to keep the service accurate and available, but maintenance, provider failures or events outside our control may interrupt access. These terms may be updated when the service or legal requirements change.',
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <article className="mx-auto max-w-4xl px-5 py-14 md:px-10 md:py-20">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-.04em] sm:text-5xl">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-slate-500">
          Effective 23 September 2026
        </p>
        <p className="mt-7 max-w-3xl leading-7 text-slate-600">
          These terms govern customer and organiser use of Naija Tickets. By
          creating an account or completing a purchase, you agree to them.
        </p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section
              key={section.title}
              className="border-t border-[#241b3f]/10 pt-7"
            >
              <h2 className="text-xl font-black">{section.title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{section.body}</p>
            </section>
          ))}
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}
