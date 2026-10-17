import type { Metadata } from 'next';
import { readHostedLink } from '@/lib/integrations/hosted-links.server';
import { HostedLinkStart } from '@/components/hosted-link-start';
export const metadata: Metadata = {
  title: 'Secure checkout | Naija Tickets',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';
export default async function HostedLinkPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const link = await readHostedLink(publicId).catch(() => null);
  return (
    <main className="min-h-screen bg-[#fffaf0] px-5 py-12 text-[#241b3f]">
      <section className="mx-auto max-w-xl rounded-2xl border border-[#241b3f]/10 bg-white p-6 sm:p-9">
        <p className="text-sm font-bold text-emerald-700">
          Naija Tickets · Secure checkout
        </p>
        <h1 className="mt-4 text-3xl font-black">
          {link ? link.event.title : 'Checkout unavailable'}
        </h1>
        {link ? (
          <HostedLinkStart publicId={publicId} />
        ) : (
          <p className="mt-4 text-slate-600">
            This event link is unavailable or ticket sales have ended. Please
            return to the organiser’s website.
          </p>
        )}
      </section>
    </main>
  );
}
