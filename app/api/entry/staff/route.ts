import { isEntryEventId } from '@/lib/event-entry';
import { organiserIdsForUser } from '@/lib/organiser-account';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
async function manageStaff(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user)
      return Response.json(
        { error: 'Sign in to manage entry staff.' },
        { status: 401 },
      );
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!isEntryEventId(body?.eventId))
      return Response.json({ error: 'Select an event.' }, { status: 400 });
    const client = getSupabaseAdminClient();
    if (request.method === 'POST') {
      if (
        typeof body.email !== 'string' ||
        body.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      ) {
        return Response.json(
          { error: 'Enter a valid staff email address.' },
          { status: 400 },
        );
      }
      const { error } = await client.rpc('assign_event_entry_staff', {
        p_actor_id: user.id,
        p_event_id: body.eventId,
        p_email: body.email,
      });
      if (error?.code === '42501')
        return Response.json(
          { error: 'Organiser access required.' },
          { status: 403 },
        );
      if (error?.code === '22023')
        return Response.json(
          {
            error:
              'Ask this staff member to create and confirm an account first.',
          },
          { status: 400 },
        );
      if (error) throw error;
    } else {
      if (!isEntryEventId(body.staffId))
        return Response.json(
          { error: 'Select a staff member.' },
          { status: 400 },
        );
      const organiserIds = await organiserIdsForUser(user.id);
      const event = await client
        .from('events')
        .select('organiser_id')
        .eq('id', body.eventId)
        .maybeSingle();
      if (event.error) throw event.error;
      if (!event.data || !organiserIds.includes(event.data.organiser_id))
        return Response.json(
          { error: 'Organiser access required.' },
          { status: 403 },
        );
      const { error } = await client
        .from('event_staff_assignments')
        .delete()
        .eq('event_id', body.eventId)
        .eq('staff_id', body.staffId);
      if (error) throw error;
    }
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: 'Unable to update entry staff.' },
      { status: 500 },
    );
  }
}
export const POST = manageStaff;
export const DELETE = manageStaff;
