'use client';

import { LogOut, Menu, Search, Ticket, X } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });
    const { data: listener } = client.auth.onAuthStateChange(
      (_event, session) => {
        setSignedIn(Boolean(session));
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await getSupabaseBrowserClient().auth.signOut();
    window.location.href = '/';
  };
  const toggleSearch = () => {
    setSearchOpen((current) => {
      const next = !current;
      if (next) window.setTimeout(() => searchRef.current?.focus(), 0);
      return next;
    });
  };
  const submitSearch = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    window.location.href = value
      ? `/search?q=${encodeURIComponent(value)}`
      : '/search';
  };
  return (
    <header className="sticky top-0 z-40 border-b border-[#241b3f]/10 bg-[#fffaf0]/92 px-5 text-[#241b3f] backdrop-blur-xl md:px-10">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between">
        <a href="/" className="flex min-h-11 items-center gap-2 text-xl">
          <span className="grid h-8 w-8 place-items-center bg-emerald-500 text-emerald-950">
            <Ticket className="h-4 w-4" />
          </span>
          <span className="brand-wordmark">Naija Tickets</span>
        </a>
        <nav
          className="hidden items-center gap-7 text-sm font-semibold lg:flex"
          aria-label="Main navigation"
        >
          <a
            href="/events"
            className="inline-flex min-h-11 items-center transition hover:text-emerald-400"
          >
            Find events
          </a>
          <a
            href="/cities"
            className="inline-flex min-h-11 items-center transition hover:text-emerald-400"
          >
            Browse cities
          </a>
          <a
            href="/about"
            className="inline-flex min-h-11 items-center transition hover:text-emerald-400"
          >
            About us
          </a>
        </nav>
        <div className="hidden items-center gap-4 lg:flex">
          <form
            onSubmit={submitSearch}
            className={`flex h-11 items-center overflow-hidden border-b transition-[width,border-color] duration-300 ${searchOpen ? 'w-52 border-emerald-400' : 'w-11 border-transparent'}`}
          >
            <button
              type="button"
              onClick={toggleSearch}
              aria-label={searchOpen ? 'Close search' : 'Open site search'}
              aria-expanded={searchOpen}
              className="grid h-11 w-11 shrink-0 place-items-center transition hover:text-emerald-400"
            >
              {searchOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>
            <label htmlFor="site-search" className="sr-only">
              Search the site
            </label>
            <input
              ref={searchRef}
              id="site-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events…"
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-[#241b3f] outline-none placeholder:text-slate-400"
            />
          </form>
          {signedIn ? (
            <>
              <a
                href="/organiser"
                className="inline-flex min-h-11 items-center px-1 text-sm font-bold transition hover:text-emerald-400"
              >
                Organiser workspace
              </a>
              <button
                type="button"
                onClick={signOut}
                className="flex min-h-11 items-center gap-2 bg-[#ff6b4a] px-4 text-sm font-bold text-white transition hover:bg-[#ee5535]"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </>
          ) : (
            <>
              <a
                href="/login"
                className="inline-flex min-h-11 items-center px-1 text-sm font-bold transition hover:text-emerald-400"
              >
                Log in
              </a>
              <a
                href="/signup"
                className="inline-flex min-h-11 items-center bg-[#ff6b4a] px-4 text-sm font-bold text-white transition hover:bg-[#ee5535]"
              >
                Sign up
              </a>
            </>
          )}
        </div>
        <button
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="grid h-11 w-11 place-items-center hover:bg-emerald-50 lg:hidden"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <nav
          className="border-t border-[#241b3f]/10 py-4 lg:hidden"
          aria-label="Mobile navigation"
        >
          <form
            onSubmit={submitSearch}
            className="mb-2 flex border border-[#241b3f]/10 bg-white"
          >
            <Search className="ml-3 h-5 w-5 self-center text-emerald-400" />
            <label htmlFor="mobile-site-search" className="sr-only">
              Search the site
            </label>
            <input
              id="mobile-site-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events…"
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none"
            />
            <button className="bg-emerald-500 px-4 text-sm font-bold text-emerald-950">
              Go
            </button>
          </form>
          <a
            className="block px-3 py-3 font-bold hover:bg-emerald-50"
            href="/events"
          >
            Find events
          </a>
          <a
            className="block px-3 py-3 font-bold hover:bg-emerald-50"
            href="/cities"
          >
            Browse cities
          </a>
          <a
            className="block px-3 py-3 font-bold hover:bg-emerald-50"
            href="/about"
          >
            About us
          </a>
          {signedIn ? (
            <div className="mt-2 grid gap-2">
              <a
                className="bg-emerald-100 px-3 py-3 text-center font-bold text-emerald-900"
                href="/organiser"
              >
                Organiser workspace
              </a>
              <button
                type="button"
                onClick={signOut}
                className="bg-[#ff6b4a] px-3 py-3 text-center font-bold text-white"
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a className="px-3 py-3 text-center font-bold" href="/login">
                Log in
              </a>
              <a
                className="bg-[#ff6b4a] px-3 py-3 text-center font-bold text-white"
                href="/signup"
              >
                Sign up
              </a>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[#241b3f]/10 bg-[#241b3f] px-5 py-10 text-white md:px-10">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <p className="brand-wordmark text-lg">Naija Tickets</p>
          <p className="mt-1 text-sm text-violet-200">
            Good events. Clear tickets. Better memories.
          </p>
        </div>
        <div className="-mx-2 flex flex-wrap gap-x-1 text-sm font-semibold text-violet-100">
          <a
            className="inline-flex min-h-11 items-center px-2 hover:text-emerald-400"
            href="/events"
          >
            Explore
          </a>
          <a
            className="inline-flex min-h-11 items-center px-2 hover:text-emerald-400"
            href="/cities"
          >
            Cities
          </a>
          <a
            className="inline-flex min-h-11 items-center px-2 hover:text-emerald-400"
            href="/about"
          >
            About us
          </a>
          <a
            className="inline-flex min-h-11 items-center px-2 hover:text-emerald-400"
            href="mailto:hello@example.com"
          >
            Help
          </a>
        </div>
      </div>
    </footer>
  );
}
