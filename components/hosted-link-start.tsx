'use client';
import { useEffect, useRef, useState } from 'react';
export function HostedLinkStart({ publicId }: { publicId: string }) {
  const intent = useRef(''),
    [error, setError] = useState('');
  useEffect(() => {
    intent.current ||= crypto.randomUUID();
    void fetch(`/api/integrations/links/${publicId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent_id: intent.current }),
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          checkout_url?: string;
          error?: string;
        };
        if (!response.ok || !result.checkout_url)
          throw new Error(result.error || 'Checkout unavailable.');
        const url = new URL(result.checkout_url);
        if (
          url.origin !== location.origin ||
          !/^\/integrations\/checkout\/[a-f0-9-]{36}$/.test(url.pathname)
        )
          throw new Error('Checkout unavailable.');
        location.replace(url.toString());
      })
      .catch(() =>
        setError(
          'Checkout could not be opened. Please refresh this page to try again.',
        ),
      );
  }, [publicId]);
  return error ? (
    <p role="alert" className="mt-5 text-red-800">
      {error}
    </p>
  ) : (
    <output className="mt-5 block text-slate-600">
      Opening secure checkout…
    </output>
  );
}
