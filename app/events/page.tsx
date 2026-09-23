'use client';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EventCard } from '@/components/event-card';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { categories, cityOptions, eventPrice, type Event } from '@/lib/events';
import { compareTrendingEvents } from '@/lib/trending-events';
import { usePublishedEvents } from '@/lib/use-published-events';

type Filters = {
  q: string;
  city: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
};
const defaults: Filters = {
  q: '',
  city: '',
  category: '',
  dateFrom: '',
  dateTo: '',
  minPrice: '',
  maxPrice: '',
  sort: 'relevance',
};

function fromUrl(): Filters {
  if (typeof window === 'undefined') return defaults;
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') || '',
    city: p.get('city') || '',
    category: p.get('category') || '',
    dateFrom: p.get('dateFrom') || '',
    dateTo: p.get('dateTo') || '',
    minPrice: p.get('minPrice') || '',
    maxPrice: p.get('maxPrice') || '',
    sort: p.get('sort') || 'relevance',
  };
}

function relevanceScore(event: Event, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return event.featured ? 10 : 0;
  let score = event.featured ? 2 : 0;
  if (event.title.toLowerCase().includes(term)) score += 12;
  if (event.organiser.toLowerCase().includes(term)) score += 8;
  if (event.category.toLowerCase().includes(term)) score += 6;
  if (event.city.toLowerCase().includes(term)) score += 5;
  if (event.state.toLowerCase().includes(term)) score += 4;
  if (event.venue.toLowerCase().includes(term)) score += 3;
  if (event.description.toLowerCase().includes(term)) score += 1;
  return score;
}

export default function EventsPage() {
  const catalogue = usePublishedEvents();
  const [filters, setFilters] = useState<Filters>(defaults);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const task = window.setTimeout(() => setFilters(fromUrl()), 0);
    return () => window.clearTimeout(task);
  }, []);

  const updateFilters = (changes: Partial<Filters>) => {
    const next = { ...filters, ...changes };
    setFilters(next);
    setPage(1);
    const params = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v && !(k === 'sort' && v === 'relevance')) params.set(k, v);
    });
    window.history.replaceState(
      {},
      '',
      `/events${params.size ? `?${params}` : ''}`,
    );
  };
  const update = (key: keyof Filters, value: string) =>
    updateFilters({ [key]: value });

  const results = useMemo(
    () =>
      catalogue
        .filter((event) => {
          const haystack =
            `${event.title} ${event.organiser} ${event.category} ${event.city} ${event.state} ${event.venue} ${event.description}`.toLowerCase();
          const matchesSearch =
            !filters.q || haystack.includes(filters.q.toLowerCase());
          const priceNaira = eventPrice(event) / 100;
          const minPrice = Number(filters.minPrice);
          const maxPrice = Number(filters.maxPrice);
          const matchesPrice =
            (!filters.minPrice || priceNaira >= minPrice) &&
            (!filters.maxPrice || priceNaira <= maxPrice);
          const matchesDate =
            (!filters.dateFrom || event.date >= filters.dateFrom) &&
            (!filters.dateTo || event.date <= filters.dateTo);
          const matchesTrendingEligibility =
            filters.sort !== 'trending' || event.organiserVerified === true;
          return (
            matchesSearch &&
            (!filters.city || event.city === filters.city) &&
            (!filters.category || event.category === filters.category) &&
            matchesPrice &&
            matchesDate &&
            matchesTrendingEligibility
          );
        })
        .sort((a, b) => {
          if (filters.sort === 'trending') {
            return compareTrendingEvents(a, b);
          }
          if (filters.sort === 'price-asc') {
            return eventPrice(a) - eventPrice(b);
          }
          if (filters.sort === 'price-desc') {
            return eventPrice(b) - eventPrice(a);
          }
          if (filters.sort === 'date-desc') {
            return b.date.localeCompare(a.date);
          }
          if (filters.sort === 'name') {
            return a.title.localeCompare(b.title);
          }
          if (filters.sort === 'date') {
            return a.date.localeCompare(b.date);
          }
          return (
            relevanceScore(b, filters.q) - relevanceScore(a, filters.q) ||
            a.date.localeCompare(b.date)
          );
        }),
    [catalogue, filters],
  );

  const visible = results.slice((page - 1) * 4, page * 4);
  const activeCount =
    [filters.city, filters.category].filter(Boolean).length +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.minPrice || filters.maxPrice ? 1 : 0);
  const clear = () => {
    setFilters(defaults);
    setPage(1);
    window.history.replaceState({}, '', '/events');
  };

  const filterPanel = (idPrefix: string) => (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[#241b3f]/10 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <p className="text-sm font-black">Place &amp; type</p>
          <p className="text-xs text-slate-500">Choose your scene</p>
        </div>
        <div className="space-y-3">
          <div>
            <label
              htmlFor={`${idPrefix}-city`}
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              City
            </label>
            <select
              id={`${idPrefix}-city`}
              value={filters.city}
              onChange={(e) => update('city', e.target.value)}
              className="filter-control rounded-xl border-[#241b3f]/10 bg-[#fffaf0]"
            >
              <option value="">All Nigeria</option>
              {cityOptions.map(({ city }) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-category`}
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              Category
            </label>
            <select
              id={`${idPrefix}-category`}
              value={filters.category}
              onChange={(e) => update('category', e.target.value)}
              className="filter-control rounded-xl border-[#241b3f]/10 bg-[#fffaf0]"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <fieldset className="rounded-2xl border border-[#241b3f]/10 bg-white p-4 shadow-sm">
        <legend className="sr-only">Date range</legend>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm font-black">Date range</p>
          {(filters.dateFrom || filters.dateTo) && (
            <button
              type="button"
              onClick={() => updateFilters({ dateFrom: '', dateTo: '' })}
              className="text-xs font-bold text-emerald-700"
            >
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor={`${idPrefix}-date-from`}
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              From
            </label>
            <input
              id={`${idPrefix}-date-from`}
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(e) => update('dateFrom', e.target.value)}
              className="filter-control min-w-0 rounded-xl border-[#241b3f]/10 bg-[#fffaf0] px-2 text-xs"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-date-to`}
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              To
            </label>
            <input
              id={`${idPrefix}-date-to`}
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(e) => update('dateTo', e.target.value)}
              className="filter-control min-w-0 rounded-xl border-[#241b3f]/10 bg-[#fffaf0] px-2 text-xs"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-[#241b3f]/10 bg-white p-4 shadow-sm">
        <legend className="sr-only">Price range</legend>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black">Price</p>
            <p className="text-xs text-slate-500">Prices in naira</p>
          </div>
          {(filters.minPrice || filters.maxPrice) && (
            <button
              type="button"
              onClick={() => updateFilters({ minPrice: '', maxPrice: '' })}
              className="text-xs font-bold text-emerald-700"
            >
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor={`${idPrefix}-minimum-price`}
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              Minimum
            </label>
            <div className="price-filter-control flex h-12 w-full items-center overflow-hidden rounded-xl border border-[#241b3f]/10 bg-[#fffaf0] pl-2.5 transition-colors">
              <span className="text-xs font-bold text-slate-400">₦</span>
              <input
                id={`${idPrefix}-minimum-price`}
                type="number"
                inputMode="numeric"
                min="0"
                step="500"
                placeholder="0"
                value={filters.minPrice}
                onChange={(e) => update('minPrice', e.target.value)}
                className="price-filter-input h-full min-w-0 w-full bg-transparent px-1.5 text-sm placeholder:text-slate-400"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-maximum-price`}
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              Maximum
            </label>
            <div className="price-filter-control flex h-12 w-full items-center overflow-hidden rounded-xl border border-[#241b3f]/10 bg-[#fffaf0] pl-2.5 transition-colors">
              <span className="text-xs font-bold text-slate-400">₦</span>
              <input
                id={`${idPrefix}-maximum-price`}
                type="number"
                inputMode="numeric"
                min={filters.minPrice || '0'}
                step="500"
                placeholder="Any"
                value={filters.maxPrice}
                onChange={(e) => update('maxPrice', e.target.value)}
                className="price-filter-input h-full min-w-0 w-full bg-transparent px-1.5 text-sm placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      </fieldset>

      {activeCount > 0 && (
        <button
          onClick={clear}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#241b3f]/10 bg-white text-sm font-bold text-[#241b3f] shadow-sm transition hover:border-[#ff6b4a]/50 hover:bg-[#fff0eb]"
        >
          <X className="h-4 w-4" />
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <section className="border-b border-[#241b3f]/10 bg-[#fff3d8]">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-10">
          <p className="eyebrow">Across Nigeria</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">
            Find something worth showing up for.
          </h1>
          <div className="mt-7 flex max-w-3xl items-center gap-3 border border-[#241b3f]/10 bg-white px-4 py-3">
            <Search className="h-5 w-5 text-emerald-400" />
            <label htmlFor="catalogue-search" className="sr-only">
              Search events
            </label>
            <input
              id="catalogue-search"
              value={filters.q}
              onChange={(e) => update('q', e.target.value)}
              placeholder="Search by event, organiser or venue"
              className="min-w-0 flex-1 bg-transparent text-[#241b3f] outline-none placeholder:text-slate-400"
            />
            {filters.q && (
              <button
                aria-label="Clear search"
                onClick={() => update('q', '')}
                className="grid h-11 w-11 place-items-center"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:px-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <div className="mb-4 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-emerald-700" />
                <h2 className="font-black">Filters</h2>
              </div>
              {activeCount > 0 && (
                <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-bold text-emerald-950">
                  {activeCount}
                </span>
              )}
            </div>
            {filterPanel('desktop')}
          </div>
        </aside>
        <section aria-live="polite">
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              <strong className="text-[#241b3f]">{results.length}</strong>{' '}
              {results.length === 1 ? 'event' : 'events'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileFilters(true)}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-[#241b3f]/10 bg-white px-3 text-sm font-bold shadow-sm lg:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" /> Filters{' '}
                {activeCount > 0 && `(${activeCount})`}
              </button>
              <label className="flex items-center gap-2 text-sm">
                <span className="hidden text-slate-500 sm:inline">Sort</span>
                <select
                  value={filters.sort}
                  onChange={(e) => update('sort', e.target.value)}
                  className="h-11 rounded-xl border border-[#241b3f]/10 bg-white px-3 font-semibold text-[#241b3f] shadow-sm"
                >
                  <option value="relevance">Most relevant</option>
                  <option value="trending">Trending</option>
                  <option value="date">Date: soonest</option>
                  <option value="date-desc">Date: latest</option>
                  <option value="price-asc">Price: lowest to highest</option>
                  <option value="price-desc">Price: highest to lowest</option>
                  <option value="name">Name: A–Z</option>
                </select>
              </label>
            </div>
          </div>
          {visible.length ? (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                {visible.map((event) => (
                  <EventCard key={event.slug} event={event} />
                ))}
              </div>
              {results.length > 4 && (
                <nav
                  className="mt-9 flex items-center justify-center gap-2"
                  aria-label="Pagination"
                >
                  {Array.from(
                    { length: Math.ceil(results.length / 4) },
                    (_, index) => index + 1,
                  ).map((n) => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      aria-current={page === n ? 'page' : undefined}
                      className={`h-11 w-11 text-sm font-bold ${page === n ? 'bg-emerald-500 text-emerald-950' : 'border border-[#241b3f]/10 bg-white'}`}
                    >
                      {n}
                    </button>
                  ))}
                </nav>
              )}
            </>
          ) : (
            <div className="border border-dashed border-[#241b3f]/15 bg-white p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center bg-emerald-500/10">
                <Search className="h-5 w-5 text-emerald-400" />
              </div>
              <h2 className="mt-4 text-xl font-black">No events found</h2>
              <p className="mt-2 text-sm text-slate-600">
                Try a broader search or clear your filters.
              </p>
              <button
                onClick={clear}
                className="mt-5 bg-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950"
              >
                Clear all filters
              </button>
            </div>
          )}
        </section>
      </div>
      {mobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close filters"
            className="absolute inset-0 h-full w-full bg-black/70"
            onClick={() => setMobileFilters(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-auto rounded-t-3xl border-t border-[#241b3f]/10 bg-[#fffaf0] p-6 shadow-2xl">
            <div className="mx-auto mb-5 h-1 w-12 rounded-full bg-[#241b3f]/15" />
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Refine your search
                </p>
                <h2 className="mt-1 text-xl font-black">Filters</h2>
              </div>
              <button
                aria-label="Close filters"
                onClick={() => setMobileFilters(false)}
                className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm"
              >
                <X />
              </button>
            </div>
            {filterPanel('mobile')}
            <button
              onClick={() => setMobileFilters(false)}
              className="sticky bottom-0 mt-5 w-full rounded-xl bg-emerald-500 px-5 py-3.5 font-bold text-emerald-950 shadow-lg"
            >
              Show {results.length} events
            </button>
          </div>
        </div>
      )}
      <SiteFooter />
    </main>
  );
}
