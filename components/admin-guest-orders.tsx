'use client';

import {
  CheckCircle2,
  Eraser,
  KeyRound,
  Search,
  ShieldAlert,
  Ticket,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNaira } from '@/lib/events';
import { filterGuestOrders, type GuestOrder } from '@/lib/guest-orders';

type GuestOrdersResponse = {
  orders?: GuestOrder[];
  outcome?: string;
  error?: string;
};

function statusClass(status: string) {
  if (status === 'paid') return 'bg-emerald-100 text-emerald-800';
  if (status === 'pending') return 'bg-amber-100 text-amber-800';
  if (status.includes('refund')) return 'bg-violet-100 text-violet-800';
  return 'bg-slate-100 text-slate-700';
}

export function AdminGuestOrders() {
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erasingId, setErasingId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/admin/guest-orders');
        const result = (await response.json()) as GuestOrdersResponse;
        if (!response.ok) {
          throw new Error(
            result.error || 'Guest purchases could not be loaded.',
          );
        }
        setOrders(result.orders || []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Guest purchases could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const visibleOrders = useMemo(
    () => filterGuestOrders(orders, query),
    [orders, query],
  );

  const closeConfirmation = () => {
    setErasingId('');
    setCurrentPassword('');
    setConfirmation('');
  };

  const erasePersonalData = async (orderId: string) => {
    if (!currentPassword || confirmation !== 'ERASE') {
      setError('Enter your password and type ERASE to confirm.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/guest-orders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, currentPassword, confirmation }),
      });
      const result = (await response.json()) as GuestOrdersResponse;
      if (!response.ok) {
        throw new Error(
          result.error || 'Guest personal data could not be erased.',
        );
      }
      setOrders(result.orders || []);
      closeConfirmation();
      setNotice(
        result.outcome === 'already_erased'
          ? 'This guest purchase was already anonymized.'
          : 'Guest personal data erased. Financial and ticket records were retained.',
      );
    } catch (eraseError) {
      setError(
        eraseError instanceof Error
          ? eraseError.message
          : 'Guest personal data could not be erased.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-rise max-w-6xl">
      <p className="eyebrow">Purchase administration</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
        Guest buyers
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Review purchases made without an account. Personal data is restricted to
        administrators and can be permanently anonymized without deleting the
        financial record or invalidating a ticket.
      </p>

      <div className="relative mt-7 max-w-2xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-600" />
        <label htmlFor="guest-order-search" className="sr-only">
          Search guest purchases
        </label>
        <Input
          id="guest-order-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, email, phone, event or order reference"
          className="h-12 border-[#241b3f]/15 bg-white pl-12 pr-11"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear guest purchase search"
            onClick={() => setQuery('')}
            className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {notice && (
        <output className="mt-6 flex items-start gap-3 border border-emerald-500/25 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </output>
      )}
      {error && (
        <output className="mt-6 flex items-start gap-3 border border-red-500/25 bg-red-50 p-4 text-sm text-red-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </output>
      )}

      <div className="mt-7 space-y-4">
        {loading ? (
          <div className="border border-[#241b3f]/10 bg-white p-10 text-center text-sm text-slate-500">
            Loading guest purchases...
          </div>
        ) : visibleOrders.length ? (
          visibleOrders.map((order) => {
            const erased = Boolean(order.personalDataErasedAt);
            return (
              <article
                key={order.id}
                className="border border-[#241b3f]/10 bg-white p-5 sm:p-6"
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-black">
                        {order.purchaserName}
                      </h2>
                      <span
                        className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider ${statusClass(order.status)}`}
                      >
                        {order.status.replaceAll('_', ' ')}
                      </span>
                      {erased && (
                        <span className="bg-slate-800 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                          Anonymized
                        </span>
                      )}
                    </div>
                    {!erased && (
                      <p className="mt-2 break-words text-sm text-slate-600">
                        {order.purchaserEmail}
                        <span className="mx-2 text-slate-300">|</span>
                        {order.purchaserPhone}
                      </p>
                    )}
                  </div>
                  {!erased && erasingId !== order.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setErasingId(order.id);
                        setError('');
                        setNotice('');
                      }}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border border-red-500/25 px-4 text-sm font-bold text-red-700 transition hover:bg-red-50"
                    >
                      <Eraser className="h-4 w-4" /> Delete personal data
                    </button>
                  )}
                </div>

                <dl className="mt-5 grid gap-4 border-t border-[#241b3f]/10 pt-5 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="lg:col-span-2">
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Event
                    </dt>
                    <dd className="mt-1 font-bold">{order.eventTitle}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Amount
                    </dt>
                    <dd className="mt-1 font-bold">
                      {formatNaira(order.totalKobo)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Tickets
                    </dt>
                    <dd className="mt-1 flex items-center gap-2 font-bold">
                      <Ticket className="h-4 w-4 text-emerald-600" />
                      {order.ticketCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Purchased
                    </dt>
                    <dd className="mt-1 font-bold">
                      {new Date(order.createdAt).toLocaleDateString('en-NG', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 break-all font-mono text-xs text-slate-500">
                  Order {order.reference}
                </p>

                {erasingId === order.id && (
                  <div className="mt-5 border border-red-500/25 bg-red-50 p-5">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                      <div>
                        <h3 className="font-black text-red-900">
                          Permanently erase this guest’s personal data?
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-red-800">
                          Name, email, phone and attendee contact fields will be
                          anonymized. Payment totals, the order, ticket codes,
                          ticket status and audit history will remain.
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          className="auth-label"
                          htmlFor={`guest-erasure-password-${order.id}`}
                        >
                          Current admin password
                        </label>
                        <div className="relative">
                          <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                          <Input
                            id={`guest-erasure-password-${order.id}`}
                            type="password"
                            value={currentPassword}
                            onChange={(event) =>
                              setCurrentPassword(event.target.value)
                            }
                            autoComplete="current-password"
                            className="auth-input pl-11"
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          className="auth-label"
                          htmlFor={`guest-erasure-confirm-${order.id}`}
                        >
                          Type ERASE to confirm
                        </label>
                        <Input
                          id={`guest-erasure-confirm-${order.id}`}
                          value={confirmation}
                          onChange={(event) =>
                            setConfirmation(event.target.value.toUpperCase())
                          }
                          autoComplete="off"
                          className="auth-input"
                        />
                      </div>
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <Button
                        type="button"
                        disabled={
                          saving || !currentPassword || confirmation !== 'ERASE'
                        }
                        onClick={() => void erasePersonalData(order.id)}
                        className="h-11 bg-red-700 px-5 font-black text-white hover:bg-red-800"
                      >
                        {saving ? 'Erasing data...' : 'Erase personal data'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={closeConfirmation}
                        className="h-11 px-5 font-black"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <div className="border border-dashed border-[#241b3f]/15 p-10 text-center">
            <h2 className="text-xl font-black">
              {query ? 'No matching guest purchases' : 'No guest purchases yet'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {query
                ? 'Try a different name, email, phone, event or order reference.'
                : 'Orders placed without an account will appear here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
