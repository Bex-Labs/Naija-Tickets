import { SiteHeader, SiteFooter } from '@/components/site-header';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: {
    default: 'Developers | Naija Tickets',
    template: '%s | Naija Tickets Developers',
  },
  description:
    'Integrate event discovery, hosted checkout, public ticket widgets and signed notifications with Naija Tickets.',
};
const links = [
  ['Overview', '/developers'],
  ['Get started', '/developers/getting-started'],
  ['API reference', '/developers/reference'],
  ['Checkout', '/developers/checkout'],
  ['Widget', '/developers/widget'],
  ['Webhooks', '/developers/webhooks'],
  ['Sandbox', '/developers/sandbox'],
];
export default function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <div className="border-y border-[#241b3f]/10 bg-white">
        <nav
          aria-label="Developer navigation"
          className="mx-auto flex max-w-7xl flex-wrap gap-x-4 px-5 py-2 md:px-10"
        >
          {links.map(([name, href]) => (
            <a
              key={href}
              href={href}
              className="inline-flex min-h-10 items-center text-xs font-bold text-slate-600 hover:text-emerald-800"
            >
              {name}
            </a>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
        {children}
      </div>
      <SiteFooter />
    </main>
  );
}
