import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Privacy Policy | Naija Tickets',
  description: 'How Naija Tickets handles personal information.',
};

const sections = [
  {
    title: 'Information we collect',
    body: 'We collect account details such as your name, email address and phone number; attendee details supplied during checkout; order, payment-status and ticket records; organiser profile and verification information; and technical information needed to operate and secure the service.',
  },
  {
    title: 'How we use information',
    body: 'We use information to authenticate accounts, process and verify bookings, issue and deliver tickets, support event entry, show account history, prevent misuse, review organisers and operate the platform.',
  },
  {
    title: 'When information is shared',
    body: 'Relevant attendee and order details are shared with the organiser of the purchased event. Necessary information may also be processed by providers that support authentication, payments, email delivery, hosting and security. We do not provide payment-card credentials to organisers.',
  },
  {
    title: 'Storage and retention',
    body: 'Information is retained for as long as needed to provide the service, maintain financial and ticket records, resolve disputes and meet legal obligations. Guest personal information may be removed while required financial and ticket records are preserved.',
  },
  {
    title: 'Your choices',
    body: 'You can update available account information, disconnect an organiser payout account and contact support about access or correction requests. Signing out does not delete purchase or ticket records associated with your account.',
  },
  {
    title: 'Security and updates',
    body: 'We use access controls and trusted server operations to limit access to sensitive records. No system is completely risk-free. This policy may be updated as the platform, providers or legal requirements change.',
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <article className="mx-auto max-w-4xl px-5 py-14 md:px-10 md:py-20">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-.04em] sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-slate-500">
          Effective 23 September 2026
        </p>
        <p className="mt-7 max-w-3xl leading-7 text-slate-600">
          This policy explains what information Naija Tickets handles and how it
          is used when you browse events, create an account, buy tickets or
          organise an event.
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
