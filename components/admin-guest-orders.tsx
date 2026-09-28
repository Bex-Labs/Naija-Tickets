'use client';

import {
  CheckCircle2,
  Eraser,
  KeyRound,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
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
        Purchases made without an account. Guests whose personal data has been
        erased are hidden.
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

      <div className="mt-5">
        {loading ? (
          <div className="border border-[#241b3f]/10 bg-white p-10 text-center text-sm text-slate-500">
            Loading guest purchases...
          </div>
        ) : visibleOrders.length ? (
          <div className="overflow-x-auto border border-[#241b3f]/10 bg-white">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {[
                    'Guest / contact',
                    'Event / reference',
                    'Tickets',
                    'Amount',
                    'Status',
                    'Date',
                    '',
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-3 py-2 font-semibold"
                    >
                      {heading || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOrders.map((order) => (
                  <Fragment key={order.id}>
                    <tr className="align-middle">
                      <td className="px-3 py-2">
                        <span className="block font-bold">
                          {order.purchaserName}
                        </span>
                        <span className="block text-slate-500">
                          {order.purchaserEmail} ·{' '}
                          {order.purchaserPhone || 'No phone'}
                        </span>
                      </td>
                      <td className="max-w-64 px-3 py-2">
                        <span
                          className="block truncate font-semibold"
                          title={order.eventTitle}
                        >
                          {order.eventTitle}
                        </span>
                        <span className="block break-all font-mono text-[10px] text-slate-500">
                          {order.reference}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {order.ticketCount}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold">
                        {formatNaira(order.totalKobo)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`whitespace-nowrap px-2 py-1 text-[10px] font-bold capitalize ${statusClass(order.status)}`}
                        >
                          {order.status.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {new Date(order.createdAt).toLocaleDateString('en-NG', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          aria-label={`Erase personal data for ${order.purchaserName}`}
                          title="Erase personal data"
                          onClick={() => {
                            setErasingId(order.id);
                            setError('');
                            setNotice('');
                          }}
                          className="grid h-10 w-10 place-items-center text-red-700 hover:bg-red-50"
                        >
                          <Eraser className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                    {erasingId === order.id && (
                      <tr>
                        <td
                          colSpan={7}
                          aria-label="Confirm personal data erasure"
                        >
                          <div className="border border-red-500/25 bg-red-50 p-5">
                            <div className="flex items-start gap-3">
                              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                              <div>
                                <h3 className="font-black text-red-900">
                                  Permanently erase this guest’s personal data?
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-red-800">
                                  Name, email, phone and attendee contact fields
                                  will be anonymized. Payment totals, the order,
                                  ticket codes, ticket status and audit history
                                  will remain.
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
                                    setConfirmation(
                                      event.target.value.toUpperCase(),
                                    )
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
                                  saving ||
                                  !currentPassword ||
                                  confirmation !== 'ERASE'
                                }
                                onClick={() => void erasePersonalData(order.id)}
                                className="h-11 bg-red-700 px-5 font-black text-white hover:bg-red-800"
                              >
                                {saving
                                  ? 'Erasing data...'
                                  : 'Erase personal data'}
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
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
