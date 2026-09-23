import { NextResponse } from 'next/server';
import { accountHomeFromMetadata } from '@/lib/auth-destination';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
  });

async function customer(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return { response: respond({ error: 'Authentication required.' }, 401) };
  if (accountHomeFromMetadata(user.user_metadata) !== '/account') {
    return {
      response: respond({ error: 'A customer account is required.' }, 403),
    };
  }
  return { user };
}

async function eventIdFrom(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
  return UUID_PATTERN.test(eventId) ? eventId : '';
}

export async function GET(request: Request) {
  try {
    const auth = await customer(request);
    if ('response' in auth) return auth.response;
    const { data, error } = await getSupabaseAdminClient()
      .from('saved_events')
      .select('event_id')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return respond({ eventIds: (data || []).map((saved) => saved.event_id) });
  } catch (error) {
    console.error('Unable to load saved events', error);
    return respond({ error: 'We could not load your saved events.' }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await customer(request);
    if ('response' in auth) return auth.response;
    const eventId = await eventIdFrom(request);
    if (!eventId) return respond({ error: 'Invalid event.' }, 400);
    const client = getSupabaseAdminClient();
    const { data: event, error: eventError } = await client
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('status', 'published')
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event)
      return respond({ error: 'This event is no longer available.' }, 409);
    const { error } = await client
      .from('saved_events')
      .upsert(
        { user_id: auth.user.id, event_id: eventId },
        { onConflict: 'user_id,event_id', ignoreDuplicates: true },
      );
    if (error) throw error;
    return respond({ saved: true });
  } catch (error) {
    console.error('Unable to save event', error);
    return respond({ error: 'We could not save this event.' }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await customer(request);
    if ('response' in auth) return auth.response;
    const eventId = await eventIdFrom(request);
    if (!eventId) return respond({ error: 'Invalid event.' }, 400);
    const { error } = await getSupabaseAdminClient()
      .from('saved_events')
      .delete()
      .eq('user_id', auth.user.id)
      .eq('event_id', eventId);
    if (error) throw error;
    return respond({ saved: false });
  } catch (error) {
    console.error('Unable to remove saved event', error);
    return respond({ error: 'We could not remove this saved event.' }, 500);
  }
}
