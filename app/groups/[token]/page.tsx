import type { Metadata } from 'next';
import { SiteHeader, SiteFooter } from '@/components/site-header';
import { GroupClaimForm } from '@/components/group-claim-form';
import { getPublicGroupInvitation } from '@/lib/group-bookings.server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: 'Claim your group ticket | Naija Tickets',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function GroupInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getPublicGroupInvitation(token);
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="mx-auto max-w-2xl px-5 py-12 sm:py-18">
        <p className="eyebrow">Group invitation</p>
        {!invitation ? (
          <>
            <h1 className="mt-3 text-3xl font-black">
              This invitation is unavailable.
            </h1>
            <p className="mt-4 text-slate-600">
              The event may have ended or the booking is no longer valid.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">
              {invitation.eventTitle}
            </h1>
            <p className="mt-4 text-lg font-bold">
              {invitation.ticketName} · {invitation.admissions} admissions
            </p>
            {invitation.description && (
              <p className="mt-2 text-sm text-slate-600">
                {invitation.description}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-600">
              {new Intl.DateTimeFormat('en-NG', {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone: invitation.timezone,
              }).format(new Date(invitation.startsAt))}{' '}
              {invitation.timezoneLabel}
              <br />
              {invitation.venue}
            </p>
            <p className="mt-6 font-bold text-emerald-800">
              {invitation.remaining}{' '}
              {invitation.remaining === 1 ? 'ticket' : 'tickets'} available to
              claim
            </p>
            <GroupClaimForm token={token} remaining={invitation.remaining} />
          </>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
