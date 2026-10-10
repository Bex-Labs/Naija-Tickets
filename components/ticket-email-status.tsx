'use client';
import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
export function TicketEmailStatus({ reference }: { reference: string }) {
  const [status, setStatus] = useState('checking');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const check = async () => {
      try {
        const response = await fetch(
          `/api/tickets/email?reference=${encodeURIComponent(reference)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const result = (await response.json()) as {
          status?: string;
          enabled?: boolean;
        };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setStatus('unavailable');
          return;
        }
        setStatus(result.status || 'pending');
        setEnabled(Boolean(result.enabled));
        if (
          result.enabled &&
          ['pending', 'processing'].includes(result.status || 'pending') &&
          ++attempts < 10
        )
          timer = setTimeout(() => void check(), 3000);
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    };
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [reference]);
  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tickets/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      });
      const result = (await response.json()) as {
        status?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || 'Email could not be sent. Please try again later.',
        );
      setStatus(
        result.status === 'already_sent'
          ? 'sent'
          : result.status === 'in_progress'
            ? 'processing'
            : result.status || 'failed',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Email could not be sent.',
      );
    } finally {
      setBusy(false);
    }
  };
  const message =
    status === 'sent'
      ? 'Your confirmation was sent to the email used at checkout. Check your inbox or spam folder.'
      : status === 'checking'
        ? 'Checking your confirmation email…'
        : status === 'unavailable'
          ? 'We could not check email delivery. Your tickets are ready to view and save below.'
          : !enabled
            ? 'Email confirmations are not available yet. Your tickets are ready to view and save below.'
            : status === 'processing'
              ? 'Your confirmation email is being sent. Your tickets are ready below.'
              : status === 'retry_later'
                ? 'Please wait a minute before trying the email again.'
                : 'Your confirmation email has not been sent yet. You can retry below.';
  return (
    <div className="no-print mt-3 text-sm text-slate-600">
      <p className="flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        {message}
      </p>
      {enabled && !['sent', 'checking', 'processing'].includes(status) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void retry()}
          className="mt-2 min-h-10 font-semibold text-emerald-800 underline disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send confirmation email'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
