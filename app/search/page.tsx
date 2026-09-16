import type { Metadata } from 'next';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Info,
  MapPin,
  Search,
} from 'lucide-react';
import { EventCard } from '@/components/event-card';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { cityDescriptions, cityImages } from '@/lib/cities';
import { cities } from '@/lib/events';
import { getPublishedEvents } from '@/lib/supabase/public-events-server';

export const metadata: Metadata = {
  title: 'Search | Naija Tickets',
  description: 'Search events, cities and pages across Naija Tickets.',
};
type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const { q = '' } = await searchParams;
  const events = await getPublishedEvents();
  const query = q.trim().toLowerCase();
  const matchingEvents = query
    ? events.filter((event) =>
        `${event.title} ${event.organiser} ${event.venue} ${event.city} ${event.category}`
          .toLowerCase()
          .includes(query),
      )
    : [];
  const matchingCities = query
    ? cities.filter((city) =>
        `${city} ${cityDescriptions[city]}`.toLowerCase().includes(query),
      )
    : [];
  const pages = [
    {
      title: 'About Naija Tickets',
      description: 'Our mission, product principles and story.',
      href: '/about',
      icon: Info,
    },
    {
      title: 'Organiser workspace',
      description: 'Apply as an organiser and manage events.',
      href: '/organiser',
      icon: Building2,
    },
    {
      title: 'Browse all events',
      description: 'Filter the full event catalogue.',
      href: '/events',
      icon: CalendarDays,
    },
  ];
  const matchingPages = query
    ? pages.filter((page) =>
        `${page.title} ${page.description}`.toLowerCase().includes(query),
      )
    : [];
  const total =
    matchingEvents.length + matchingCities.length + matchingPages.length;
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="border-b border-[#241b3f]/10 bg-[#fff3d8]">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10">
          <p className="eyebrow">Global search</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">
            Search all of Naija Tickets
          </h1>
          <form
            className="mt-7 flex max-w-3xl border border-[#241b3f]/10 bg-white"
            action="/search"
          >
            <Search className="ml-4 h-5 w-5 self-center text-emerald-400" />
            <label htmlFor="global-search-page" className="sr-only">
              Search the whole app
            </label>
            <input
              id="global-search-page"
              name="q"
              defaultValue={q}
              placeholder="Try Lagos, concert, organiser or about…"
              className="min-w-0 flex-1 bg-transparent px-4 py-4 text-[#241b3f] outline-none placeholder:text-slate-400"
            />
            <button className="bg-[#ff6b4a] px-6 font-black text-white">
              Search
            </button>
          </form>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-5 py-12 md:px-10">
        {!query ? (
          <div className="border border-dashed border-[#241b3f]/15 p-10 text-center">
            <Search className="mx-auto h-7 w-7 text-emerald-400" />
            <h2 className="mt-4 text-xl font-black">
              What are you looking for?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Search events, cities, organisers and platform pages.
            </p>
          </div>
        ) : total === 0 ? (
          <div className="border border-dashed border-[#241b3f]/15 p-10 text-center">
            <h2 className="text-xl font-black">No results for “{q}”</h2>
            <p className="mt-2 text-sm text-slate-600">
              Try a city, event category or shorter phrase.
            </p>
            <a
              href="/events"
              className="mt-5 inline-flex min-h-11 items-center bg-emerald-500 px-4 text-sm font-bold text-emerald-950"
            >
              Browse all events
            </a>
          </div>
        ) : (
          <div className="space-y-14">
            <p className="text-sm text-slate-600">
              <strong className="text-[#241b3f]">{total}</strong> results for “
              {q}”
            </p>
            {matchingEvents.length > 0 && (
              <section>
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-2xl font-black">Events</h2>
                  <a
                    href={`/events?q=${encodeURIComponent(q)}`}
                    className="inline-flex min-h-11 items-center text-sm font-bold text-emerald-700"
                  >
                    Open catalogue <ArrowRight className="inline h-4 w-4" />
                  </a>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  {matchingEvents.map((event) => (
                    <EventCard key={event.slug} event={event} />
                  ))}
                </div>
              </section>
            )}
            {matchingCities.length > 0 && (
              <section>
                <h2 className="mb-6 text-2xl font-black">Cities</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {matchingCities.map((city) => (
                    <a
                      key={city}
                      href={`/events?city=${encodeURIComponent(city)}`}
                      aria-label={`View events in ${city}`}
                      className="group flex items-center gap-4 border border-[#241b3f]/10 bg-white p-3 hover:border-emerald-400"
                    >
                      <img
                        src={cityImages[city]}
                        alt=""
                        className="h-16 w-20 object-cover"
                      />
                      <div>
                        <p className="flex items-center gap-2 font-black">
                          <MapPin className="h-4 w-4 text-emerald-400" />
                          {city}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          View events
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}
            {matchingPages.length > 0 && (
              <section>
                <h2 className="mb-6 text-2xl font-black">Pages and tools</h2>
                <div className="grid gap-4 md:grid-cols-3">
                  {matchingPages.map(({ icon: Icon, ...page }) => (
                    <a
                      key={page.href}
                      href={page.href}
                      className="border border-[#241b3f]/10 bg-white p-5 transition hover:border-emerald-400"
                    >
                      <Icon className="h-5 w-5 text-emerald-400" />
                      <h3 className="mt-5 font-black">{page.title}</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        {page.description}
                      </p>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
