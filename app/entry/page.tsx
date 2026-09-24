import type { Metadata } from 'next';
import { EventEntry } from '@/components/event-entry';
import { SiteHeader, SiteFooter } from '@/components/site-header';
export const metadata: Metadata = { title: 'Event entry | Naija Tickets' };
export default function EntryPage() {
  return (
    <div className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <EventEntry />
      <SiteFooter />
    </div>
  );
}
