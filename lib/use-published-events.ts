'use client';

import { useEffect, useId, useState } from 'react';
import {
  databaseRowToPublicEvent,
  isRetiredSeedEvent,
  publicEventSelect,
  type DatabaseEventRow,
} from '@/lib/database-events';
import type { Event } from '@/lib/events';
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
        .order('published_at', { ascending: false });
      if (!active || error) return;
      const liveEvents = ((data || []) as unknown as DatabaseEventRow[])
        .filter((event) => !isRetiredSeedEvent(event))
        .map(databaseRowToPublicEvent);
      setCatalogue(liveEvents);
    };

    void load();
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
      void client.removeChannel(channel);
    };
  }, [channelId]);

  return catalogue;
}
