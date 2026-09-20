'use client';

import { BadgeCheck, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OrganiserVerificationState } from '@/lib/organiser-verification';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function OrganiserVerificationAlert({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [decision, setDecision] = useState<OrganiserVerificationState | null>(
    null,
  );
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let lastReview = '';
    const check = async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session) return;
        const response = await fetch('/api/organiser/verification', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const result = (await response.json()) as {
          verification?: OrganiserVerificationState;
        };
        if (active) {
          const current = result.verification?.decisionUnread
            ? result.verification
            : null;
          setDecision(current);
          if (current?.reviewedAt && current.reviewedAt !== lastReview) {
            lastReview = current.reviewedAt;
            window.dispatchEvent(new Event('organiser-verification-decision'));
          }
        }
      } catch {
        /* A later poll can recover a transient network failure. */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const dismiss = async () => {
    if (!decision?.reviewedAt) return;
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error('Your session has expired.');
      const response = await fetch('/api/organiser/verification', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reviewedAt: decision.reviewedAt }),
      });
      if (!response.ok) throw new Error('The alert could not be dismissed.');
      setDecision(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The alert could not be dismissed.',
      );
    }
  };

  if (!decision) return null;
  const approved = decision.status === 'verified';
  return (
    <aside
      className={`mb-6 flex flex-wrap items-start gap-3 border p-4 ${approved ? 'border-emerald-500/30 bg-emerald-50' : 'border-amber-400/40 bg-amber-50'}`}
      aria-label="Organiser verification decision"
    >
      {approved ? (
        <BadgeCheck className="h-5 w-5 shrink-0 fill-emerald-500 text-white" />
      ) : (
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-700" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-black">
          {approved
            ? 'Your organiser profile is verified'
            : 'Your organiser verification was not approved'}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {approved
            ? 'Your profile now displays a green verified tick, and new events can be published after event review.'
            : decision.reviewNote ||
              'Review your details and submit them again.'}
        </p>
        {!approved && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2 text-sm font-bold text-emerald-800 underline"
          >
            Update verification details
          </button>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void dismiss()}
        aria-label="Dismiss verification alert"
        className="min-h-10 min-w-10 p-2"
      >
        <X className="h-5 w-5" />
      </button>
    </aside>
  );
}
