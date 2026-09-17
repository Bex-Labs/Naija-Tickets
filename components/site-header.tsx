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
  const [pathname, setPathname] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pathnameTask = window.setTimeout(
      () => setPathname(window.location.pathname),
      0,
    );
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });
    const { data: listener } = client.auth.onAuthStateChange(
      (_event, session) => {
        setSignedIn(Boolean(session));
      },
    );
    return () => {
      window.clearTimeout(pathnameTask);
      listener.subscription.unsubscribe();
    };
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
  const isActive = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`);
  const desktopNavClass = (href: string) =>
    `inline-flex min-h-11 items-center border-b-2 transition ${
      isActive(href)
        ? 'border-emerald-500 text-emerald-800'
        : 'border-transparent hover:text-emerald-600'
    }`;
  const mobileNavClass = (href: string) =>
    `block border-l-4 px-3 py-3 font-bold transition ${
      isActive(href)
        ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
        : 'border-transparent hover:bg-emerald-50'
    }`;
  return (
    <header className="sticky top-0 z-40 border-b border-[#241b3f]/10 bg-[#fffaf0]/92 px-5 text-[#241b3f] backdrop-blur-xl md:px-10">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between">
        <a
          href="/"
          aria-current={isActive('/') ? 'page' : undefined}
          className={`flex min-h-11 items-center gap-2 text-xl transition ${isActive('/') ? 'text-emerald-800' : ''}`}
        >
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
            aria-current={isActive('/events') ? 'page' : undefined}
            className={desktopNavClass('/events')}
          >
            Find events
          </a>
          <a
            href="/cities"
            aria-current={isActive('/cities') ? 'page' : undefined}
            className={desktopNavClass('/cities')}
          >
            Browse cities
          </a>
          <a
            href="/about"
            aria-current={isActive('/about') ? 'page' : undefined}
            className={desktopNavClass('/about')}
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
              className={`grid h-11 w-11 shrink-0 place-items-center transition hover:text-emerald-600 ${isActive('/search') ? 'bg-emerald-50 text-emerald-800' : ''}`}
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
                aria-current={isActive('/organiser') ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-bold transition ${isActive('/organiser') ? 'border-emerald-500 text-emerald-800' : 'border-transparent hover:text-emerald-600'}`}
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
                aria-current={isActive('/login') ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-bold transition ${isActive('/login') ? 'border-emerald-500 text-emerald-800' : 'border-transparent hover:text-emerald-600'}`}
              >
                Log in
              </a>
              <a
                href="/signup"
                aria-current={isActive('/signup') ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center px-4 text-sm font-bold text-white transition ${isActive('/signup') ? 'bg-[#d9472a] ring-2 ring-[#ff6b4a]/30 ring-offset-2' : 'bg-[#ff6b4a] hover:bg-[#ee5535]'}`}
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
            aria-current={isActive('/events') ? 'page' : undefined}
            className={mobileNavClass('/events')}
            href="/events"
          >
            Find events
          </a>
          <a
            aria-current={isActive('/cities') ? 'page' : undefined}
            className={mobileNavClass('/cities')}
            href="/cities"
          >
            Browse cities
          </a>
          <a
            aria-current={isActive('/about') ? 'page' : undefined}
            className={mobileNavClass('/about')}
            href="/about"
          >
            About us
          </a>
          {signedIn ? (
            <div className="mt-2 grid gap-2">
              <a
                className="bg-emerald-100 px-3 py-3 text-center font-bold text-emerald-900"
                href="/organiser"
                aria-current={isActive('/organiser') ? 'page' : undefined}
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
              <a
                className={`px-3 py-3 text-center font-bold ${isActive('/login') ? 'bg-emerald-50 text-emerald-900' : ''}`}
                href="/login"
                aria-current={isActive('/login') ? 'page' : undefined}
              >
                Log in
              </a>
              <a
                className="bg-[#ff6b4a] px-3 py-3 text-center font-bold text-white"
                href="/signup"
                aria-current={isActive('/signup') ? 'page' : undefined}
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
