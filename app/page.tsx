import {
  ArrowRight,
  CalendarDays,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  TicketCheck,
} from 'lucide-react';
import {
  FeaturedEvents,
  TrendingEvents,
  UpcomingEvents,
} from '@/components/home-event-sections';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { cities, homeCategories } from '@/lib/events';

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <section className="relative flex min-h-[min(760px,calc(100vh-72px))] overflow-hidden border-b border-[#241b3f]/10 bg-black">
        <img
          src="/hero-daytime-concert.jpg"
          alt="Concertgoers enjoying a sunny outdoor performance beside the water"
          className="absolute inset-0 h-full w-full object-cover object-[62%_center] sm:object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(36,27,63,.28),rgba(36,27,63,.05)_42%,rgba(36,27,63,.72))]" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col justify-between px-5 pb-8 pt-20 text-center md:px-10 md:pb-12 md:pt-28">
          <div className="animate-rise mx-auto my-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[.24em] text-emerald-300">
              Live. Local. Unforgettable.
            </p>
            <h1 className="mt-5 font-heading text-5xl font-black leading-none tracking-[-.055em] text-white sm:text-7xl lg:text-8xl">
              Discover new experiences
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-white/75 sm:text-lg">
              Concerts, festivals, conferences and remarkable nights across
              Nigeria.
            </p>
          </div>
          <form
            action="/events"
            className="animate-rise-delay grid border border-white/80 bg-white/95 p-2 text-left text-[#241b3f] shadow-2xl backdrop-blur-xl sm:grid-cols-[1.5fr_1fr_1fr_auto]"
          >
            <label className="flex items-center gap-3 border-b border-[#241b3f]/10 px-4 py-3 sm:border-b-0 sm:border-r">
              <Search className="h-5 w-5 text-emerald-600" />
              <span className="sr-only">Search events</span>
              <input
                name="q"
                placeholder="Search events, artists or venues"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </label>
            <label className="flex items-center gap-3 border-b border-[#241b3f]/10 px-4 py-3 sm:border-b-0 sm:border-r">
              <MapPin className="h-5 w-5 text-emerald-600" />
              <span className="sr-only">City</span>
              <select
                name="city"
                className="w-full bg-transparent text-sm outline-none"
              >
                <option value="">All Nigeria</option>
                {cities.map((city) => (
                  <option key={city}>{city}</option>
                ))}
              </select>
            </label>
            <span className="flex items-center gap-3 px-4 py-3 text-sm">
              <CalendarDays className="h-5 w-5 text-emerald-600" /> Upcoming
            </span>
            <button className="bg-[#ff6b4a] px-8 py-3 text-sm font-black text-white transition hover:bg-[#ee5535]">
              Explore
            </button>
          </form>
        </div>
      </section>

      <section className="border-y border-[#241b3f]/10 bg-[#fff1b8] py-6 md:py-8">
        <div className="mx-auto max-w-7xl px-5 md:px-10">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Popular right now</p>
              <h2 className="mt-1 font-heading text-2xl font-black tracking-tight sm:text-3xl">
                Trending events
              </h2>
            </div>
            <a
              href="/events?sort=trending"
              className="hidden min-h-11 items-center gap-2 text-sm font-bold text-emerald-700 transition hover:text-emerald-600 sm:flex"
            >
              View all <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <TrendingEvents />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 md:px-10 md:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Handpicked for you</p>
            <h2 className="section-title">Featured events</h2>
          </div>
          <a
            href="/events"
            className="hidden min-h-11 items-center gap-2 text-sm font-bold text-emerald-700 transition hover:text-emerald-600 sm:flex"
          >
            View all <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <FeaturedEvents />
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 md:px-10 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr]">
          <div>
            <p className="eyebrow">Whatever moves you</p>
            <h2 className="section-title max-w-sm">
              Find your kind of gathering
            </h2>
            <p className="mt-4 max-w-md leading-7 text-slate-600">
              From industry-shaping ideas to the loudest nights out, there’s
              always something worth showing up for.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-2">
              {homeCategories.map((category) => (
                <a
                  key={category}
                  href={`/events?category=${encodeURIComponent(category)}`}
                  className="border border-[#241b3f]/10 bg-white px-4 py-3 text-sm font-bold shadow-sm transition hover:-translate-y-0.5 hover:border-[#ff6b4a] hover:bg-[#fff0eb]"
                >
                  {category}
                </a>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xl font-black">Coming up soon</h3>
              <span className="text-xs font-semibold text-slate-500">
                Africa/Lagos time
              </span>
            </div>
            <UpcomingEvents />
          </div>
        </div>
      </section>

      <section
        id="about"
        className="border-t border-[#241b3f]/10 bg-[#f5efff] px-5 py-14 md:px-10 md:py-20"
      >
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_.8fr] lg:items-center">
          <div>
            <p className="eyebrow">About Naija Tickets</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
              Built for the moments Nigeria talks about tomorrow.
            </h2>
            <p className="mt-5 max-w-2xl leading-7 text-slate-600">
              We make it easier to discover trusted events, understand exactly
              what you’re buying and get through the door without friction.
            </p>
            <div className="mt-7 flex flex-wrap gap-5 text-sm text-slate-700">
              <span className="flex items-center gap-2">
                <TicketCheck className="h-4 w-4 text-emerald-400" /> Clear
                ticket options
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" /> Secure
                admissions
              </span>
            </div>
          </div>
          <div className="border border-[#ff6b4a]/30 bg-[#fff0eb] p-7 shadow-sm">
            <Sparkles className="h-6 w-6 text-[#ff6b4a]" />
            <p className="mt-4 text-xl font-black">
              Ready to find your next event?
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Browse experiences across Nigeria, with more cities and
              communities being added as the platform grows.
            </p>
            <a
              href="/events"
              className="mt-6 inline-flex items-center gap-2 bg-[#ff6b4a] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#ee5535]"
            >
              Explore events <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
