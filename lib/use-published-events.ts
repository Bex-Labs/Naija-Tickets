'use client';

import { useEffect, useId, useState } from 'react';
import {
  databaseRowToPublicEvent,
  isRetiredSeedEvent,
  publicEventSelect,
  type DatabaseEventRow,
} from '@/lib/database-events';
import type { Event } from '@/lib/events';
import { eventHasEnded } from '@/lib/event-availability';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function usePublishedEvents() {
  const [catalogue, setCatalogue] = useState<Event[]>([]);
  const channelId = useId();

  useEffect(() => {
    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }
    let active = true;
    const load = async () => {
      const { data, error } = await client
        .from('events')
        .select(publicEventSelect)
        .eq('status', 'published')
        .gt('ends_at', new Date().toISOString())
        .order('published_at', { ascending: false });
      if (!active || error) return;
      const liveEvents = ((data || []) as unknown as DatabaseEventRow[])
        .filter((event) => !isRetiredSeedEvent(event))
        .map(databaseRowToPublicEvent);
      setCatalogue(liveEvents);
    };

    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const channel = client
      .channel(`public-events-catalogue-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        () => void load(),
      )
      .subscribe();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      void client.removeChannel(channel);
    };
  }, [channelId]);

  useEffect(() => {
    if (!catalogue.length) return;
    const nextEnd = Math.min(
      ...catalogue.map((event) => Date.parse(event.endsAt || '')),
    );
    const timer = window.setTimeout(
      () => {
        setCatalogue((events) =>
          events.filter((event) => !eventHasEnded(event.endsAt || '')),
        );
      },
      Math.max(0, Math.min(nextEnd - Date.now(), 2_147_483_647)),
    );
    return () => window.clearTimeout(timer);
  }, [catalogue]);

  return catalogue;
}
