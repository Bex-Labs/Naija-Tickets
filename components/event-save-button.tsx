'use client';

import { Heart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountHomeFromMetadata } from '@/lib/auth-destination';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const savedByUser = new Map<string, Promise<Set<string>>>();

async function savedIds(userId: string, accessToken: string) {
  let request = savedByUser.get(userId);
  if (!request) {
    request = fetch('/api/customer/saved-events', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          eventIds?: string[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Saved events could not be loaded.');
        return new Set(result.eventIds || []);
      })
      .catch((error) => {
        savedByUser.delete(userId);
        throw error;
      });
    savedByUser.set(userId, request);
  }
  return request;
}

export function EventSaveButton({
  eventId,
  eventSlug,
  initialSaved,
  showLabel = false,
  className = '',
  onChange,
}: {
  eventId: string;
  eventSlug?: string | null;
  initialSaved?: boolean;
  showLabel?: boolean;
  className?: string;
  onChange?: (saved: boolean) => void;
}) {
  const [saved, setSaved] = useState(Boolean(initialSaved));
  const [busy, setBusy] = useState(false);
  const [eligible, setEligible] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialSaved !== undefined) return;
    let active = true;
    void (async () => {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) return;
      if (
        accountHomeFromMetadata(data.session.user.user_metadata) !== '/account'
      ) {
        if (active) setEligible(false);
        return;
      }
      try {
        const ids = await savedIds(
          data.session.user.id,
          data.session.access_token,
        );
        if (active) setSaved(ids.has(eventId));
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Unable to load.');
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId, initialSaved]);

  if (!eligible) return null;

  const toggle = async () => {
    setError('');
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (!data.session) {
      const next = eventSlug ? `/events/${eventSlug}` : '/events';
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (
      accountHomeFromMetadata(data.session.user.user_metadata) !== '/account'
    ) {
      setEligible(false);
      return;
    }
    const nextSaved = !saved;
    setSaved(nextSaved);
    setBusy(true);
    try {
      const response = await fetch('/api/customer/saved-events', {
        method: nextSaved ? 'POST' : 'DELETE',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eventId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          result.error || 'The saved event could not be updated.',
        );
      const ids = await savedIds(
        data.session.user.id,
        data.session.access_token,
      );
      if (nextSaved) ids.add(eventId);
      else ids.delete(eventId);
      onChange?.(nextSaved);
    } catch (cause) {
      setSaved(!nextSaved);
      setError(
        cause instanceof Error
          ? cause.message
          : 'The saved event could not be updated.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={className} title={error || undefined}>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        aria-label={saved ? 'Remove from saved events' : 'Save event'}
        aria-pressed={saved}
        className={`inline-flex min-h-11 items-center justify-center gap-2 border px-3 text-sm font-black shadow-sm transition disabled:opacity-60 ${
          saved
            ? 'border-emerald-500 bg-emerald-500 text-emerald-950'
            : 'border-[#241b3f]/15 bg-white text-[#241b3f] hover:border-emerald-500'
        }`}
      >
        <Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
        {showLabel && (saved ? 'Saved' : 'Save event')}
      </button>
    </span>
  );
}
