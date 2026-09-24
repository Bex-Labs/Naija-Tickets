import { isEntryEventId } from '@/lib/event-entry';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user)
      return Response.json(
        { error: 'Sign in to verify tickets.' },
        { status: 401 },
      );
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !isEntryEventId(body?.eventId) ||
      typeof body?.code !== 'string' ||
      body.code.length > 100 ||
      (body?.action !== 'verify' && body?.action !== 'admit')
    ) {
      return Response.json(
        { error: 'Select an event and enter a ticket code.' },
        { status: 400 },
      );
    }
    const { data, error } = await getSupabaseAdminClient().rpc(
      'verify_event_entry',
      {
        p_staff_id: user.id,
        p_event_id: body.eventId,
        p_code: body.code,
        p_admit: body.action === 'admit',
      },
    );
    if (error?.code === '42501')
      return Response.json(
        { error: 'You are not assigned to this event.' },
        { status: 403 },
      );
    if (error) throw error;
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      {
        error:
          'Unable to confirm entry. Check your connection and verify the ticket again.',
      },
      { status: 500 },
    );
  }
}
