'use client';

import { ArrowRight } from 'lucide-react';
import { EventCard } from '@/components/event-card';
import {
  selectFeaturedEvents,
  selectUpcomingEvents,
} from '@/lib/featured-events';
import { selectTrendingEvents } from '@/lib/trending-events';
import { usePublishedEvents } from '@/lib/use-published-events';

export function TrendingEvents() {
  const trending = selectTrendingEvents(usePublishedEvents());

  if (!trending.length) {
    return (
      <div className="border border-dashed border-[#241b3f]/15 bg-white p-8 text-center md:col-span-2 lg:col-span-4">
        <h3 className="text-xl font-black">Trending events are coming soon</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
          New popular experiences will appear here as the community books.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {trending.map((event) => (
        <EventCard key={event.slug} event={event} compact />
      ))}
    </div>
  );
}

export function FeaturedEvents() {
  const catalogue = usePublishedEvents();
  const featured = selectFeaturedEvents(catalogue);

  if (!featured.length) {
    return (
      <div className="border border-dashed border-[#241b3f]/15 bg-white p-8 text-center md:col-span-3">
        <h3 className="text-xl font-black">Featured events are coming soon</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
          Explore all currently published events while our editors prepare the
          next featured collection.
        </p>
        <a
          href="/events"
          className="mt-5 inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-4 text-sm font-black text-emerald-950"
        >
          Browse events <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {featured.map((event) => (
        <EventCard key={event.slug} event={event} />
      ))}
    </div>
  );
}

export function UpcomingEvents() {
  const catalogue = selectUpcomingEvents(usePublishedEvents());

  if (!catalogue.length) {
    return (
      <div className="border border-dashed border-[#241b3f]/15 bg-white p-8 text-center">
        <h3 className="font-black">More events are on the way</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Check back soon for newly approved experiences.
        </p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-[#241b3f]/10 border-y border-[#241b3f]/10">
      {catalogue.map((event) => (
        <a
          key={event.slug}
          href={`/events/${event.slug}`}
          className="group grid grid-cols-[4.75rem_4rem_1fr_auto] items-center gap-4 py-4 transition hover:text-emerald-700"
        >
          <img
            src={event.image}
            alt=""
            className="h-14 w-[4.75rem] object-cover transition group-hover:brightness-110"
            loading="lazy"
          />
          <div className="text-center">
            <span className="block text-xs font-bold uppercase text-emerald-700">
              {new Intl.DateTimeFormat('en-NG', { month: 'short' }).format(
                new Date(`${event.date}T12:00:00+01:00`),
              )}
            </span>
            <span className="text-2xl font-black">{event.date.slice(-2)}</span>
          </div>
          <div>
            <p className="font-extrabold">{event.title}</p>
            <p className="mt-1 text-sm text-slate-500">
              {event.city} · {event.time}
            </p>
          </div>
          <ArrowRight className="h-4 w-4" />
        </a>
      ))}
    </div>
  );
}
