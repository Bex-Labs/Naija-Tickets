import type { Metadata } from 'next';
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  MapPin,
  UserRound,
} from 'lucide-react';
import { EventShareButton } from '@/components/event-share-button';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { TicketSelector } from '@/components/ticket-selector';
import { getPublishedEventBySlug } from '@/lib/supabase/public-events-server';

type Props = { params: Promise<{ slug: string }> };
export const dynamic = 'force-dynamic';

async function findEvent(slug: string) {
  return getPublishedEventBySlug(slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await findEvent(slug);
  if (!event) return { title: 'Event not found | Naija Tickets' };
  return {
    title: `${event.title} | Naija Tickets`,
    description: event.description,
    openGraph: {
      title: event.title,
      description: event.description,
      images: [event.image],
    },
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description: event.description,
      images: [event.image],
    },
  };
}

export default async function EventDetails({ params }: Props) {
  const { slug } = await params;
  const event = await findEvent(slug);
  if (!event)
    return (
      <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-5 py-24 text-center">
          <h1 className="text-4xl font-black">Event not found</h1>
          <p className="mt-3 text-slate-600">
            This event may have moved, ended or been removed.
          </p>
          <a
            href="/events"
            className="mt-6 inline-flex bg-emerald-500 px-5 py-3 font-bold text-emerald-950"
          >
            Browse events
          </a>
        </div>
      </main>
    );
  const mapsUrl =
    event.directionsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`;
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <div className="mx-auto max-w-7xl px-5 py-6 md:px-10">
        <a
          href="/events"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-emerald-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to events
        </a>
      </div>
      <section className="mx-auto max-w-7xl px-5 pb-10 md:px-10">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-white sm:aspect-[16/8] sm:min-h-72">
          <img
            src={event.image}
            alt={`${event.title} event atmosphere`}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
          <span className="absolute left-5 top-5 bg-black/75 px-3 py-1 text-xs font-bold text-white backdrop-blur">
            {event.category}
          </span>
          {event.soldOut && (
            <span className="absolute right-5 top-5 bg-emerald-500 px-3 py-1 text-xs font-bold text-emerald-950">
              Sold out
            </span>
          )}
        </div>
      </section>
      <div className="mx-auto grid max-w-7xl gap-10 px-5 pb-28 md:px-10 lg:grid-cols-[1fr_23rem] lg:pb-20">
        <article>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="eyebrow">
                {event.presenterLine || `${event.organiser} presents`}
              </p>
              <h1 className="mt-3 text-4xl font-black leading-tight tracking-[-.04em] sm:text-5xl">
                {event.title}
              </h1>
            </div>
            <EventShareButton title={event.title} />
          </div>
          <div className="mt-7 grid gap-4 border border-[#241b3f]/10 bg-white p-5 sm:grid-cols-2">
            <div className="flex gap-3">
              <CalendarDays className="mt-0.5 h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-black">{event.displayDate}</p>
                <p className="mt-1 text-sm text-slate-500">{event.time}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-black">{event.venue}</p>
                <p className="mt-1 text-sm text-slate-500">{event.address}</p>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex min-h-11 items-center text-xs font-bold text-emerald-700"
                >
                  Get directions ↗
                </a>
              </div>
            </div>
          </div>
          <section className="detail-section">
            <h2>About this event</h2>
            <p>{event.description}</p>
          </section>
          {event.schedule.length > 0 && (
            <section className="detail-section">
              <h2>Schedule</h2>
              <div className="mt-4 divide-y divide-[#241b3f]/10 border-y border-[#241b3f]/10">
                {event.schedule.map((item, index) => (
                  <div
                    key={`${item.time}-${item.title}-${index}`}
                    className="grid grid-cols-[6rem_1fr] gap-4 py-4"
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                      <Clock3 className="h-4 w-4" />
                      {item.time}
                    </span>
                    <span className="text-sm font-semibold">{item.title}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {event.policies.length > 0 && (
            <section className="detail-section">
              <h2>Event policies</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                {event.policies.map((policy, index) => (
                  <li key={`${policy}-${index}`} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-emerald-400" />
                    {policy}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="detail-section">
            <h2>About the organiser</h2>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center bg-emerald-500/10 text-emerald-400">
                <UserRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-black">{event.organiser}</p>
                {event.organiserAbout && (
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    {event.organiserAbout}
                  </p>
                )}
                {event.organiserSocials &&
                  event.organiserSocials.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                      {event.organiserSocials.map((social) => (
                        <a
                          key={social.label}
                          href={social.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center text-xs font-bold text-emerald-700 hover:text-emerald-600"
                        >
                          {social.label} ↗
                        </a>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          </section>
        </article>
        <aside className="lg:relative">
          <div className="lg:sticky lg:top-28">
            <TicketSelector
              eventSlug={event.slug}
              tickets={event.ticketTypes}
              soldOut={event.soldOut}
            />
          </div>
        </aside>
      </div>
      {!event.soldOut && (
        <a
          href="#tickets"
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 bg-emerald-500 px-5 py-4 text-center font-bold text-emerald-950 shadow-xl lg:hidden"
        >
          Choose tickets
        </a>
      )}
      <SiteFooter />
    </main>
  );
}
