'use client';

import { useEffect } from 'react';

export function HostedPopupCompletion({
  sessionId,
  environment,
}: {
  sessionId: string;
  environment: 'test' | 'live';
}) {
  useEffect(() => {
    if (!window.opener || window.opener.closed) return;
    window.opener.postMessage(
      {
        type: 'naija:checkout:complete:v1',
        sessionId,
        status: 'paid',
        environment,
      },
      window.location.origin,
    );
    const close = window.setTimeout(() => window.close(), 350);
    return () => window.clearTimeout(close);
  }, [environment, sessionId]);
  return (
    <p className="mt-4 text-sm text-slate-600">
      Payment verified. Returning you to the event website…
    </p>
  );
}
