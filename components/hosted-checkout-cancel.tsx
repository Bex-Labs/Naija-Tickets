'use client';
import { useState } from 'react';
export function HostedCheckoutCancel({
  sessionId,
  access,
}: {
  sessionId: string;
  access: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/integrations/checkout/${sessionId}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access }),
        },
      );
      const result = (await response.json()) as {
        statusUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.statusUrl)
        throw Error(result.error ?? 'Checkout could not be cancelled.');
      window.location.assign(result.statusUrl);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Checkout could not be cancelled.',
      );
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-7xl px-4 pb-6 sm:px-5 md:px-10">
      <button
        type="button"
        disabled={busy}
        onClick={() => void cancel()}
        className="min-h-11 text-sm font-semibold text-slate-600 underline underline-offset-4"
      >
        {busy ? 'Returning…' : 'Cancel and return to the website'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
