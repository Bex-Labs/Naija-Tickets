import { createClient } from '@supabase/supabase-js';
import {
  databaseRowToPublicEvent,
  isRetiredSeedEvent,
  publicEventSelect,
  type DatabaseEventRow,
} from '@/lib/database-events';

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getPublishedEvents() {
  const client = publicClient();
  if (!client) return [];
  const { data, error } = await client
    .from('events')
    .select(publicEventSelect)
    .eq('status', 'published')
    .gt('ends_at', new Date().toISOString())
    .order('published_at', { ascending: false });
  if (error) return [];
  return ((data || []) as unknown as DatabaseEventRow[])
    .filter((event) => !isRetiredSeedEvent(event))
    .map(databaseRowToPublicEvent);
}

export async function getPublishedEventBySlug(slug: string) {
  const client = publicClient();
  if (!client) return null;
  const { data, error } = await client
    .from('events')
    .select(publicEventSelect)
    .eq('slug', slug)
    .eq('status', 'published')
    .gt('ends_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  const event = data as unknown as DatabaseEventRow;
  return isRetiredSeedEvent(event) ? null : databaseRowToPublicEvent(event);
}
