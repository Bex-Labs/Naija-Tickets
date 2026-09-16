import type { Metadata } from 'next';
import { ArrowRight, MapPin } from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { cityDescriptions, cityImages } from '@/lib/cities';
import { featuredCities } from '@/lib/events';
import { getPublishedEvents } from '@/lib/supabase/public-events-server';

export const metadata: Metadata = {
  title: 'Browse cities | Naija Tickets',
  description:
    'Discover events in six featured Nigerian cities, then explore the full national catalogue.',
};

export const dynamic = 'force-dynamic';

export default async function CitiesPage() {
  const events = await getPublishedEvents();
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="border-b border-[#241b3f]/10 bg-[#fff3d8]">
        <div className="mx-auto max-w-7xl px-5 py-14 md:px-10 md:py-20">
          <p className="eyebrow">Featured cities</p>
          <h1 className="mt-3 max-w-4xl text-5xl font-black leading-none tracking-[-.05em] sm:text-7xl">
            Find your city. Find your crowd.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Explore what’s happening across Nigeria or jump straight into the
            full event search.
          </p>
          <a
            href="/events"
            className="mt-7 inline-flex items-center gap-2 bg-emerald-500 px-5 py-3 font-bold text-emerald-950"
          >
            Search all events
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-14 md:grid-cols-2 md:px-10 md:py-20 lg:grid-cols-3">
        {featuredCities.map((city) => {
          const cityEvents = events.filter((event) => event.city === city);
          const nextEvent = cityEvents[0];
          return (
            <a
              key={city}
              href={`/events?city=${encodeURIComponent(city)}`}
              className="group overflow-hidden border border-[#241b3f]/10 bg-white shadow-sm transition hover:-translate-y-1 hover:border-emerald-400/50 hover:shadow-[0_20px_50px_rgba(66,42,94,.12)]"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                <img
                  src={cityImages[city]}
                  alt={`${city} city`}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                <div className="absolute inset-x-5 bottom-5 flex items-end justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                      <MapPin className="h-3.5 w-3.5" />
                      Nigeria
                    </p>
                    <h2 className="mt-1 text-3xl font-black text-white">
                      {city}
                    </h2>
                  </div>
                  <span className="bg-emerald-500 px-2 py-1 text-xs font-black text-emerald-950">
                    {cityEvents.length}{' '}
                    {cityEvents.length === 1 ? 'event' : 'events'}
                  </span>
                </div>
              </div>
              <div className="p-5">
                <p className="min-h-12 text-sm leading-6 text-slate-600">
                  {cityDescriptions[city]}
                </p>
                {nextEvent && (
                  <div className="mt-5 flex items-center gap-3 border-t border-[#241b3f]/10 pt-4">
                    <img
                      src={nextEvent.image}
                      alt=""
                      className="h-10 w-14 object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs text-slate-500">Up next</p>
                      <p className="truncate text-sm font-bold">
                        {nextEvent.title}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </section>
      <SiteFooter />
    </main>
  );
}
