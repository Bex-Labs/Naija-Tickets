'use client';

import {
  Bell,
  CalendarDays,
  CircleUserRound,
  Heart,
  LockKeyhole,
  MapPin,
  RefreshCw,
  TicketCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AccountSignOut } from '@/components/account-sign-out';
import { CustomerProfileForm } from '@/components/customer-profile-form';
import { EventSaveButton } from '@/components/event-save-button';
import { accountHomeFromMetadata } from '@/lib/auth-destination';
import type {
  CustomerAccount,
  CustomerNotification,
  CustomerPurchase,
  CustomerSavedEvent,
} from '@/lib/customer-account';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const formatAmount = (kobo: number, currency = 'NGN') =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(kobo / 100);

function formatDate(value: string, timeZone = 'Africa/Lagos') {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return status
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function PurchaseCard({ purchase }: { purchase: CustomerPurchase }) {
  const successful = ['verified', 'refunded'].includes(purchase.paymentStatus);
  return (
    <article className="overflow-hidden border border-[#241b3f]/10 bg-white shadow-sm">
      <div className="grid md:grid-cols-[11rem_1fr]">
        {purchase.event?.image ? (
          <img
            src={purchase.event.image}
            alt=""
            className="h-44 w-full object-cover md:h-full"
          />
        ) : (
          <div className="grid h-32 place-items-center bg-[#fff3d8] text-emerald-700 md:h-full">
            <TicketCheck className="h-9 w-9" />
          </div>
        )}
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">
                {purchase.quantity}{' '}
                {purchase.quantity === 1 ? 'ticket' : 'tickets'}
              </p>
              <h2 className="mt-2 text-xl font-black">
                {purchase.event?.title || 'Event purchase'}
              </h2>
              {purchase.event && (
                <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(
                      purchase.event.startsAt,
                      purchase.event.timezone,
                    )}{' '}
                    {purchase.event.timezoneLabel}
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5" />
                    {purchase.event.venue}, {purchase.event.city}
                  </p>
                </div>
              )}
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xl font-black">
                {formatAmount(purchase.totalKobo, purchase.currency)}
              </p>
              <span
                className={`mt-2 inline-block px-2 py-1 text-xs font-bold ${successful ? 'bg-transparent text-emerald-800' : 'bg-[#fff3d8] text-[#241b3f]'}`}
              >
                Payment {statusLabel(purchase.paymentStatus)}
              </span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#241b3f]/10 pt-4 text-xs text-slate-500">
            <span>Order reference: {purchase.reference}</span>
            <span>Order date: {formatDate(purchase.createdAt)}</span>
          </div>
          {purchase.tickets.length > 0 && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {purchase.tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="border border-emerald-500/20 bg-transparent p-4"
                >
                  <p className="text-xs font-bold text-emerald-800">
                    {ticket.ticketType} · {statusLabel(ticket.status)}
                  </p>
                  <p className="mt-2 font-black">{ticket.attendeeName}</p>
                  <p className="mt-2 font-mono text-xs font-bold tracking-wider text-slate-600">
                    {ticket.displayCode}
                  </p>
                </div>
              ))}
            </div>
          )}
          {successful && purchase.tickets.length > 0 && (
            <a
              href={`/payment/status?reference=${encodeURIComponent(purchase.reference)}`}
              className="mt-5 inline-flex min-h-11 items-center bg-emerald-500 px-4 text-sm font-black text-emerald-950"
            >
              Open tickets
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function SavedEventCard({
  event,
  onRemove,
}: {
  event: CustomerSavedEvent;
  onRemove: () => void;
}) {
  const content = (
    <>
      {event.image ? (
        <img
          src={event.image}
          alt=""
          className="h-40 w-full object-cover sm:h-full"
        />
      ) : (
        <div className="grid h-32 place-items-center bg-[#fff3d8] text-emerald-700 sm:h-full">
          <Heart className="h-8 w-8" />
        </div>
      )}
      <div className="p-5">
        <p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">
          {event.available ? 'Saved event' : 'Currently unavailable'}
        </p>
        <h3 className="mt-2 text-xl font-black">{event.title}</h3>
        {event.startsAt && (
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(event.startsAt, event.timezone)} {event.timezoneLabel}
          </p>
        )}
        {event.venue && (
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <MapPin className="h-3.5 w-3.5" />
            {event.venue}, {event.city}
          </p>
        )}
        {!event.available && (
          <p className="mt-3 text-sm leading-6 text-slate-500">
            This event has been removed from sale or is awaiting publication.
          </p>
        )}
      </div>
    </>
  );

  return (
    <article className="relative overflow-hidden border border-[#241b3f]/10 bg-white shadow-sm">
      <div className="grid sm:grid-cols-[9rem_1fr]">
        {event.available && event.slug ? (
          <a href={`/events/${event.slug}`} className="contents">
            {content}
          </a>
        ) : (
          content
        )}
      </div>
      <EventSaveButton
        eventId={event.eventId}
        eventSlug={event.slug}
        initialSaved
        className="absolute right-3 top-3"
        onChange={(saved) => {
          if (!saved) onRemove();
        }}
      />
    </article>
  );
}

function NotificationCard({
  notification,
}: {
  notification: CustomerNotification;
}) {
  const content = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800">
        <Bell className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-black">{notification.title}</span>
        <span className="mt-1 block text-sm leading-6 text-slate-600">
          {notification.message}
        </span>
        <span className="mt-2 block text-xs text-slate-400">
          {formatDate(notification.createdAt)}
        </span>
      </span>
      {notification.link && (
        <span className="shrink-0 text-sm font-black text-emerald-700">
          Open →
        </span>
      )}
    </>
  );
  const className =
    'flex items-start gap-4 border border-[#241b3f]/10 bg-white p-5 shadow-sm transition';
  return notification.link ? (
    <a
      href={notification.link}
      className={`${className} hover:border-emerald-400`}
    >
      {content}
    </a>
  ) : (
    <article className={className}>{content}</article>
  );
}

export function CustomerDashboard() {
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [state, setState] = useState<
    'loading' | 'signed-out' | 'ready' | 'error'
  >('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session) {
          setState('signed-out');
          return;
        }
        if (
          accountHomeFromMetadata(data.session.user.user_metadata) ===
          '/organiser'
        ) {
          window.location.replace('/organiser');
          return;
        }
        const response = await fetch('/api/customer/account', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as CustomerAccount & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Your account could not be loaded.');
        if (!controller.signal.aborted) {
          setAccount(result);
          setState('ready');
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your account could not be loaded.',
          );
          setState('error');
        }
      }
    })();
    return () => controller.abort();
  }, [reload]);

  if (state === 'loading') {
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <p className="font-bold">Loading your tickets…</p>
      </main>
    );
  }
  if (state === 'signed-out') {
    return (
      <main className="grid min-h-[70vh] place-items-center px-5">
        <section className="max-w-md border border-[#241b3f]/10 bg-white p-8 text-center shadow-sm">
          <LockKeyhole className="mx-auto h-8 w-8 text-emerald-700" />
          <h1 className="mt-5 text-3xl font-black">
            Log in to see your tickets
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            Your saved purchases and issued tickets are available from your
            account.
          </p>
          <a
            href="/login?next=/account"
            className="mt-6 inline-flex min-h-12 items-center bg-[#ff6b4a] px-6 font-black text-white"
          >
            Log in
          </a>
        </section>
      </main>
    );
  }
  if (state === 'error' || !account) {
    return (
      <main className="grid min-h-[70vh] place-items-center px-5 text-center">
        <div>
          <p className="text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => {
              setState('loading');
              setReload((value) => value + 1);
            }}
            className="mt-4 inline-flex min-h-11 items-center gap-2 font-bold text-emerald-700"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[70vh]">
      <section className="border-b border-[#241b3f]/10 bg-[#fff3d8]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5 px-5 py-12 md:px-10 md:py-16">
          <div>
            <p className="eyebrow">Customer account</p>
            <h1 className="mt-3 text-4xl font-black tracking-[-.04em] sm:text-5xl">
              My tickets
            </h1>
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <CircleUserRound className="h-4 w-4" /> {account.profile.name} ·{' '}
              {account.profile.email}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/events"
              className="min-h-11 py-3 text-sm font-bold text-emerald-700"
            >
              Find events
            </a>
            <AccountSignOut />
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-16">
        <CustomerProfileForm
          profile={account.profile}
          onSaved={(profile) =>
            setAccount((current) =>
              current ? { ...current, profile } : current,
            )
          }
        />

        <div className="mb-7 mt-14 border-t border-[#241b3f]/10 pt-12">
          <p className="eyebrow">Updates</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-.03em]">
            Notifications
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Purchase confirmations and important changes to your events appear
            here.
          </p>
        </div>
        {account.notifications.length ? (
          <div className="grid gap-3">
            {account.notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
              />
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-[#241b3f]/15 bg-white p-8 text-center">
            <Bell className="mx-auto h-8 w-8 text-emerald-600" />
            <h3 className="mt-4 text-xl font-black">No notifications yet</h3>
            <p className="mt-2 text-sm text-slate-600">
              Ticket confirmations and relevant event updates will appear here.
            </p>
          </div>
        )}

        <div className="mb-7 mt-14 border-t border-[#241b3f]/10 pt-12">
          <p className="eyebrow">Considering</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-.03em]">
            Saved events
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Keep events here while you decide which tickets to buy.
          </p>
        </div>
        {account.savedEvents.length ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {account.savedEvents.map((event) => (
              <SavedEventCard
                key={event.eventId}
                event={event}
                onRemove={() =>
                  setAccount((current) =>
                    current
                      ? {
                          ...current,
                          savedEvents: current.savedEvents.filter(
                            (saved) => saved.eventId !== event.eventId,
                          ),
                        }
                      : current,
                  )
                }
              />
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-[#241b3f]/15 bg-white p-8 text-center">
            <Heart className="mx-auto h-8 w-8 text-emerald-600" />
            <h3 className="mt-4 text-xl font-black">No saved events yet</h3>
            <p className="mt-2 text-sm text-slate-600">
              Use the heart button on an event to save it here.
            </p>
          </div>
        )}

        <div className="mb-7 mt-14 border-t border-[#241b3f]/10 pt-12">
          <p className="eyebrow">Orders</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-.03em]">
            Purchase history
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Review your previous ticket transactions and payment status.
          </p>
        </div>
        {account.purchases.length ? (
          <div className="space-y-5">
            {account.purchases.map((purchase) => (
              <PurchaseCard key={purchase.id} purchase={purchase} />
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-[#241b3f]/15 bg-white p-10 text-center">
            <TicketCheck className="mx-auto h-8 w-8 text-emerald-600" />
            <h2 className="mt-4 text-2xl font-black">No purchases yet</h2>
            <p className="mt-2 text-slate-600">
              Tickets bought while signed in will appear here automatically.
            </p>
            <a
              href="/events"
              className="mt-6 inline-flex min-h-12 items-center bg-emerald-500 px-5 font-black text-emerald-950"
            >
              Browse events
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
