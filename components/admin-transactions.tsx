'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { formatNaira } from '@/lib/events';
import type {
  AdminTransactionsPage,
  TransactionMethodFilter,
  TransactionStatusFilter,
} from '@/lib/admin-transactions';

const dateFormatter = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
});

const statusLabels: Record<TransactionStatusFilter, string> = {
  all: 'All statuses',
  verified: 'Verified',
  pending: 'Pending',
  failed: 'Failed',
  abandoned: 'Abandoned',
  expired: 'Expired',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
  needs_review: 'Needs review',
};

function statusStyle(status: string) {
  if (status === 'verified') return 'bg-emerald-100 text-emerald-800';
  if (status === 'needs_review') return 'bg-red-100 text-red-800';
  if (status === 'pending') return 'bg-amber-100 text-amber-800';
  if (status.includes('refund')) return 'bg-violet-100 text-violet-800';
  return 'bg-slate-100 text-slate-700';
}

export function AdminTransactions() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TransactionStatusFilter>('all');
  const [method, setMethod] = useState<TransactionMethodFilter>('all');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<AdminTransactionsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          search,
          status,
          method,
          page: String(page),
        });
        const response = await fetch(`/api/admin/transactions?${params}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as AdminTransactionsPage & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Transactions could not be loaded.');
        setData(result);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Transactions could not be loaded.',
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [search, status, method, page, refresh]);

  const submitSearch = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
    setRefresh((value) => value + 1);
  };

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <div className="animate-rise max-w-7xl">
      <p className="eyebrow">Payment operations</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
        Transactions
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Monitor purchases and payment attempts across the platform. Verified
        means the order and its payment verification agree; mismatches are
        flagged for review.
      </p>

      <div className="mt-7 grid gap-3 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]">
        <form onSubmit={submitSearch} className="flex min-w-0 gap-2">
          <label htmlFor="transaction-search" className="sr-only">
            Search transactions
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" />
            <input
              id="transaction-search"
              type="search"
              maxLength={100}
              placeholder="Reference, customer or event"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="min-h-11 w-full border border-[#241b3f]/20 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600"
            />
          </div>
          <button
            type="submit"
            className="min-h-11 bg-[#241b3f] px-4 text-sm font-bold text-white"
          >
            Search
          </button>
        </form>
        <label className="sr-only" htmlFor="transaction-status">
          Filter by status
        </label>
        <select
          id="transaction-status"
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value as TransactionStatusFilter);
          }}
          className="min-h-11 border border-[#241b3f]/20 bg-white px-3 text-sm"
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="transaction-method">
          Filter by payment provider
        </label>
        <select
          id="transaction-method"
          value={method}
          onChange={(event) => {
            setPage(1);
            setMethod(event.target.value as TransactionMethodFilter);
          }}
          className="min-h-11 border border-[#241b3f]/20 bg-white px-3 text-sm"
        >
          <option value="all">All payment types</option>
          <option value="paystack">Paystack</option>
          <option value="demo_free">Free bookings</option>
        </select>
        <button
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
          className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#241b3f]/20 bg-white px-3 text-sm font-bold"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="mt-6 flex items-center justify-between gap-3 text-sm text-slate-600">
        <p aria-live="polite">
          {loading
            ? 'Loading transactions…'
            : `${data?.total ?? 0} matching transactions`}
        </p>
        {data && !loading && (
          <p>
            Page {data.page} of {totalPages}
          </p>
        )}
      </div>

      <div className="mt-3 overflow-x-auto border border-[#241b3f]/10 bg-white">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-[#fff3d8] text-xs uppercase tracking-wider text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-4">
                Order / date
              </th>
              <th scope="col" className="px-4 py-4">
                Customer
              </th>
              <th scope="col" className="px-4 py-4">
                Event
              </th>
              <th scope="col" className="px-4 py-4">
                Amount
              </th>
              <th scope="col" className="px-4 py-4">
                Payment method
              </th>
              <th scope="col" className="px-4 py-4">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#241b3f]/10">
            {!loading &&
              !error &&
              data?.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="px-4 py-4 align-top">
                    <span className="font-bold text-[#241b3f]">
                      {transaction.reference}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {dateFormatter.format(new Date(transaction.createdAt))}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className="font-semibold">
                      {transaction.customerName}
                    </span>
                    {transaction.customerEmail && (
                      <span className="mt-1 block text-xs text-slate-500">
                        {transaction.customerEmail}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top">
                    {transaction.eventTitle}
                  </td>
                  <td className="px-4 py-4 align-top font-bold">
                    {formatNaira(transaction.amountKobo)}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span>
                      {transaction.paymentMethod === 'card'
                        ? 'Card (Paystack)'
                        : transaction.paymentMethod === 'bank_transfer'
                          ? 'Bank transfer (Paystack)'
                          : transaction.paymentMethod === 'ussd'
                            ? 'USSD (Paystack)'
                            : transaction.paymentMethod}
                    </span>
                    {transaction.providerReference && (
                      <span className="mt-1 block text-xs text-slate-500">
                        {transaction.providerReference}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span
                      className={`inline-block px-2 py-1 text-xs font-bold ${statusStyle(transaction.status)}`}
                    >
                      {statusLabels[transaction.status] || transaction.status}
                    </span>
                    {transaction.status === 'needs_review' && (
                      <span className="mt-1 block text-xs text-red-700">
                        Order: {transaction.orderStatus.replaceAll('_', ' ')} ·
                        Payment:{' '}
                        {transaction.paymentStatus.replaceAll('_', ' ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            {!loading && !error && data?.transactions.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  No transactions match these filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  Loading transactions…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && !loading && !error && data.total > data.pageSize && (
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="min-h-11 border border-[#241b3f]/20 bg-white px-4 text-sm font-bold disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="min-h-11 border border-[#241b3f]/20 bg-white px-4 text-sm font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
