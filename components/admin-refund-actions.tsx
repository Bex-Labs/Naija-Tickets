'use client';

import { useState, type SyntheticEvent } from 'react';
import { formatNaira } from '@/lib/events';
import type { AdminTransaction } from '@/lib/admin-transactions';

function refundLabel(status: string, providerStatus: string | null) {
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (providerStatus === 'needs-attention')
    return 'Needs attention in Paystack';
  return 'Processing';
}

export function AdminRefundActions({
  transaction,
  onUpdated,
}: {
  transaction: AdminTransaction;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [refundId, setRefundId] = useState('');
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const record = async (id: string, refundReason: string) => {
    setBusyId(id);
    setError('');
    try {
      const response = await fetch('/api/admin/refunds', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: transaction.id,
          refundId: id,
          reason: refundReason,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? 'Admin session ended. Sign in again.'
            : result.error || 'The refund could not be recorded.',
        );
      }
      setOpen(false);
      setRefundId('');
      setReason('');
      onUpdated();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'The refund could not be recorded.',
      );
    } finally {
      setBusyId('');
    }
  };

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void record(refundId.trim(), reason.trim());
  };

  return (
    <div className="min-w-48 space-y-2">
      {transaction.refunds.length ? (
        <>
          <p className="font-semibold">
            {formatNaira(transaction.refundedKobo)} completed
          </p>
          {transaction.refunds.map((refund) => (
            <div
              key={refund.id}
              className="border-t border-[#241b3f]/10 pt-2 text-xs"
            >
              <p className="font-semibold">
                {formatNaira(refund.amountKobo)} ·{' '}
                {refundLabel(refund.status, refund.providerStatus)}
              </p>
              {refund.providerRefundId && (
                <p className="mt-1 text-slate-500">
                  Paystack #{refund.providerRefundId}
                </p>
              )}
              {refund.providerRefundId && refund.status === 'processing' && (
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void record(refund.providerRefundId || '', '')}
                  className="mt-1 font-bold text-emerald-700 underline disabled:opacity-50"
                >
                  {busyId === refund.providerRefundId
                    ? 'Checking…'
                    : 'Refresh status'}
                </button>
              )}
            </div>
          ))}
        </>
      ) : (
        <p className="text-xs text-slate-500">No refund recorded</p>
      )}

      {transaction.canRecordRefund && !open && (
        <>
          <p className="text-xs text-slate-500">
            Up to {formatNaira(transaction.remainingKobo)} eligible
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-9 border border-emerald-600 px-2 text-xs font-bold text-emerald-800"
          >
            Record Paystack refund
          </button>
        </>
      )}

      {open && (
        <form
          onSubmit={submit}
          className="space-y-2 border-t border-[#241b3f]/10 pt-2"
        >
          <p className="text-xs leading-5 text-slate-600">
            Issue the refund in Paystack first. Enter its refund ID; the amount
            and status are verified directly with Paystack.
          </p>
          <label
            htmlFor={`refund-id-${transaction.id}`}
            className="block text-xs font-bold"
          >
            Paystack refund ID
          </label>
          <input
            id={`refund-id-${transaction.id}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]+"
            maxLength={20}
            required
            value={refundId}
            onChange={(event) => setRefundId(event.target.value)}
            className="min-h-10 w-full border border-[#241b3f]/20 bg-white px-2 text-sm"
          />
          <label
            htmlFor={`refund-reason-${transaction.id}`}
            className="block text-xs font-bold"
          >
            Reason for record
          </label>
          <textarea
            id={`refund-reason-${transaction.id}`}
            minLength={5}
            maxLength={500}
            required
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full border border-[#241b3f]/20 bg-white p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={Boolean(busyId)}
              className="min-h-9 bg-[#241b3f] px-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busyId ? 'Verifying…' : 'Verify and record'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-9 px-2 text-xs font-bold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
