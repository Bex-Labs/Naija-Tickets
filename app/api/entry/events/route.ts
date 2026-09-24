import type { EntryEvent } from '@/lib/event-entry';
import { organiserIdsForUser } from '@/lib/organiser-account';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user)
      return Response.json(
        { error: 'Sign in to access event entry.' },
        { status: 401 },
      );
    const client = getSupabaseAdminClient();
    const [organiserIds, assigned] = await Promise.all([
      organiserIdsForUser(user.id),
      client
        .from('event_staff_assignments')
        .select('event_id')
        .eq('staff_id', user.id),
    ]);
    if (assigned.error) throw assigned.error;
    const fields = 'id,title,status,starts_at,organiser_id';
    const [owned, staffed] = await Promise.all([
      organiserIds.length
        ? client.from('events').select(fields).in('organiser_id', organiserIds)
        : { data: [], error: null },
      assigned.data.length
        ? client
            .from('events')
            .select(fields)
            .in(
              'id',
              assigned.data.map((row) => row.event_id),
            )
        : { data: [], error: null },
    ]);
    if (owned.error || staffed.error) throw owned.error || staffed.error;
    const events = new Map<string, EntryEvent>();
    for (const event of [...(staffed.data || []), ...(owned.data || [])]) {
      events.set(event.id, {
        id: event.id,
        title: event.title,
        status: event.status,
        starts_at: event.starts_at,
        canManageStaff: organiserIds.includes(event.organiser_id),
        staff: [],
      });
    }
    const ownedIds = [...events.values()]
      .filter((event) => event.canManageStaff)
      .map((event) => event.id);
    if (ownedIds.length) {
      const assignments = await client
        .from('event_staff_assignments')
        .select('event_id,staff_id')
        .in('event_id', ownedIds);
      if (assignments.error) throw assignments.error;
      const ids = [...new Set(assignments.data.map((row) => row.staff_id))];
      if (ids.length) {
        const profiles = await client
          .from('profiles')
          .select('id,full_name')
          .in('id', ids);
        if (profiles.error) throw profiles.error;
        for (const assignment of assignments.data) {
          events
            .get(assignment.event_id)
            ?.staff.push({
              id: assignment.staff_id,
              name:
                profiles.data.find(
                  (profile) => profile.id === assignment.staff_id,
                )?.full_name || 'Entry staff',
            });
        }
      }
    }
    return Response.json(
      {
        events: [...events.values()].sort((a, b) =>
          b.starts_at.localeCompare(a.starts_at),
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Unable to load your assigned events.' },
      { status: 500 },
    );
  }
}
