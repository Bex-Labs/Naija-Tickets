'use client';

import {
  Building2,
  CalendarCheck2,
  Check,
  CreditCard,
  LayoutDashboard,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Star,
  Ticket,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdminSalesOverview } from '@/components/admin-sales-analytics';
import { AdminTransactions } from '@/components/admin-transactions';
import { AdminAccounts } from '@/components/admin-accounts';
import { AdminGuestOrders } from '@/components/admin-guest-orders';
import { AdminSettings } from '@/components/admin-settings';
import { AdminSignOut } from '@/components/admin-sign-out';
import { AdminUserDirectory } from '@/components/admin-user-directory';
import { AdminOrganiserVerification } from '@/components/admin-organiser-verification';
import { VerifiedOrganiserBadge } from '@/components/verified-organiser-badge';
import type { OrganiserEvent } from '@/lib/organiser-types';

type Tab =
  | 'overview'
  | 'customers'
  | 'guests'
  | 'transactions'
  | 'organisers'
  | 'admins'
  | 'events'
  | 'settings';

export function AdminWorkspace() {
  const [events, setEvents] = useState<OrganiserEvent[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [notice, setNotice] = useState('');
  const [reviewingId, setReviewingId] = useState('');

  useEffect(() => {
    const loadEvents = async () => {
      const response = await fetch('/api/admin/events');
      const result = (await response.json()) as {
        events?: OrganiserEvent[];
        error?: string;
      };
      if (!response.ok) {
        setNotice(result.error || 'We could not load event submissions.');
        return;
      }
      setEvents(result.events || []);
    };
    void loadEvents();
  }, [tab]);

  const decideEvent = async (id: string, approved: boolean) => {
    setReviewingId(id);
    setNotice('');
    try {
      const response = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review', id, approved }),
      });
      const result = (await response.json()) as {
        events?: OrganiserEvent[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Review failed.');
      setEvents(result.events || []);
      setNotice(
        approved
          ? 'Event approved and published on the public site.'
          : 'Event returned to the organiser with a review reason.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Review failed.');
    } finally {
      setReviewingId('');
    }
  };

  const setFeatured = async (id: string, featured: boolean) => {
    setReviewingId(id);
    setNotice('');
    try {
      const response = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feature', id, featured }),
      });
      const result = (await response.json()) as {
        events?: OrganiserEvent[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          result.error || 'Featured status could not be updated.',
        );
      }
      setEvents(result.events || []);
      setNotice(
        featured
          ? 'Event added to the homepage featured collection.'
          : 'Event removed from the homepage featured collection.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Featured status could not be updated.',
      );
    } finally {
      setReviewingId('');
    }
  };

  const pendingEvents = events.filter((event) => event.status === 'submitted');
  const nav = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'customers', label: 'Customers', icon: UserRound },
    { id: 'guests', label: 'Guest buyers', icon: ShoppingBag },
    { id: 'transactions', label: 'Transactions', icon: CreditCard },
    { id: 'organisers', label: 'Organisers', icon: Building2 },
    { id: 'admins', label: 'Admins', icon: ShieldCheck },
    { id: 'events', label: 'Event approvals', icon: CalendarCheck2 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <header className="border-b border-[#241b3f]/10 bg-[#fff3d8] px-5">
        <div className="mx-auto flex h-18 max-w-[90rem] items-center justify-between">
          <a
            href="/"
            className="flex min-h-11 min-w-0 items-center gap-2 text-xl font-black"
          >
            <Ticket className="h-7 w-7 text-emerald-600" />
            <span className="brand-wordmark hidden min-[360px]:inline">
              Naija Tickets
            </span>
          </a>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-bold uppercase tracking-wider text-emerald-700 sm:block">
              Administration
            </span>
            <AdminSignOut />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[90rem] md:grid-cols-[15rem_1fr]">
        <aside className="border-b border-[#241b3f]/10 p-4 md:min-h-[calc(100vh-72px)] md:border-b-0 md:border-r">
          <nav
            className="grid grid-cols-2 gap-2 md:grid-cols-1"
            aria-label="Admin navigation"
          >
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setNotice('');
                }}
                className={`flex items-center gap-3 px-3 py-3 text-left text-sm font-bold transition ${tab === id ? 'bg-emerald-500 text-emerald-950' : 'text-slate-600 hover:bg-emerald-50 hover:text-[#241b3f]'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 p-5 sm:p-8 lg:p-10">
          {notice && (
            <output className="mb-6 block border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800">
              {notice}
            </output>
          )}

          {tab === 'overview' && (
            <div className="animate-rise">
              <p className="eyebrow">Platform operations</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
                Admin overview
              </h1>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Customers', 'customers', 'Manage customer accounts'],
                  ['Guest buyers', 'guests', 'Review account-free purchases'],
                  [
                    'Transactions',
                    'transactions',
                    'Monitor payments and issues',
                  ],
                  ['Organisers', 'organisers', 'Manage organiser access'],
                  ['Admins', 'admins', 'Manage administrator accounts'],
                  [
                    'Event approvals',
                    'events',
                    `${pendingEvents.length} awaiting review`,
                  ],
                ].map(([label, target, description]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTab(target as Tab)}
                    className="border border-[#241b3f]/10 bg-white p-5 text-left transition hover:border-emerald-400/60 hover:shadow-sm"
                  >
                    <p className="font-black">{label}</p>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      {description}
                    </p>
                  </button>
                ))}
              </div>
              <AdminSalesOverview />
              <div className="mt-8 border border-[#241b3f]/10 bg-white p-6">
                <Shield className="h-6 w-6 text-emerald-600" />
                <h2 className="mt-5 text-xl font-black">
                  Platform controls are active
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Manage platform access and review submitted events. Approved
                  events are published to the public catalogue immediately.
                </p>
              </div>
            </div>
          )}

          {tab === 'customers' && <AdminUserDirectory accountKind="customer" />}
          {tab === 'guests' && <AdminGuestOrders />}
          {tab === 'transactions' && <AdminTransactions />}
          {tab === 'organisers' && (
            <>
              <AdminUserDirectory accountKind="organiser" />
              <AdminOrganiserVerification />
            </>
          )}
          {tab === 'admins' && <AdminAccounts />}

          {tab === 'events' && (
            <div className="animate-rise">
              <p className="eyebrow">Content quality</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
                Event approvals
              </h1>
              {events.length ? (
                <div className="mt-8 space-y-4">
                  {events.map((event) => (
                    <article
                      key={event.id}
                      className="border border-[#241b3f]/10 bg-white p-6"
                    >
                      <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
                        <img
                          src={
                            event.imageName ||
                            'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=82'
                          }
                          alt={`${event.title} event`}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                            {event.status}
                            {event.featured ? ' · Featured' : ''}
                          </p>
                          <h2 className="mt-2 text-xl font-black">
                            {event.title}
                          </h2>
                          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                            {event.organiserDisplayName}
                            <VerifiedOrganiserBadge
                              verified={event.organiserVerified}
                            />
                          </p>
                          <p className="mt-2 text-sm text-slate-500">
                            {event.category} · {event.city} · {event.date}
                          </p>
                        </div>
                      </div>
                      <p className="mt-5 text-sm leading-6 text-slate-700">
                        {event.description}
                      </p>
                      {event.reason && (
                        <p className="mt-4 text-sm text-red-600">
                          Review note: {event.reason}
                        </p>
                      )}
                      {event.status === 'submitted' && (
                        <div className="mt-6 flex gap-3">
                          <button
                            type="button"
                            disabled={reviewingId === event.id}
                            onClick={() => void decideEvent(event.id, false)}
                            className="inline-flex min-h-11 items-center gap-2 border border-red-400/30 px-4 text-sm font-bold text-red-600"
                          >
                            <X className="h-4 w-4" /> Reject
                          </button>
                          <button
                            type="button"
                            disabled={reviewingId === event.id}
                            onClick={() => void decideEvent(event.id, true)}
                            className="inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-4 text-sm font-bold text-emerald-950"
                          >
                            <Check className="h-4 w-4" /> Publish
                          </button>
                          {!event.organiserVerified && (
                            <span className="self-center text-xs text-amber-800">
                              Unverified: only free events with up to 100
                              tickets can be published
                            </span>
                          )}
                        </div>
                      )}
                      {event.status === 'published' && (
                        <div className="mt-6">
                          <button
                            type="button"
                            aria-pressed={event.featured}
                            disabled={
                              reviewingId === event.id ||
                              !event.organiserVerified
                            }
                            onClick={() =>
                              void setFeatured(event.id, !event.featured)
                            }
                            className={`inline-flex min-h-11 items-center gap-2 px-4 text-sm font-bold ${event.featured ? 'border border-[#241b3f]/15 bg-white text-[#241b3f]' : 'bg-[#ffd75e] text-[#241b3f]'}`}
                          >
                            <Star
                              className={`h-4 w-4 ${event.featured ? 'fill-current' : ''}`}
                            />
                            {event.featured
                              ? 'Remove from featured'
                              : 'Add to featured'}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-8 border border-dashed border-[#241b3f]/15 p-10 text-center">
                  <CalendarCheck2 className="mx-auto h-7 w-7 text-emerald-600" />
                  <h2 className="mt-4 text-xl font-black">
                    No event submissions
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    New organiser submissions will appear here.
                  </p>
                </div>
              )}
            </div>
          )}
          {tab === 'settings' && <AdminSettings />}
        </section>
      </div>
    </main>
  );
}
