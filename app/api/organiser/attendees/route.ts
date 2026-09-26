import { getOrderGroupBookings } from '@/lib/group-bookings.server';
import { NextResponse } from 'next/server';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
import { organiserIdsForUser } from '@/lib/organiser-account';
import {
  attendeePageSize,
  authorisedAttendeeList,
  literalSearchPattern,
  parseAttendeeQuery,
} from '@/lib/organiser-attendees';

export async function GET(request: Request) {
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
    });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return respond({ error: 'Authentication required.' }, 401);
    const params = parseAttendeeQuery(new URL(request.url).searchParams);
    if (!params) return respond({ error: 'Invalid attendee filters.' }, 400);
    const client = getSupabaseAdminClient();
    const result = await authorisedAttendeeList(user.id, params.eventId, {
      async canView(userId, eventId) {
        const ids = await organiserIdsForUser(userId);
        if (!ids.length) return false;
        const { data, error } = await client
          .from('events')
          .select('id')
          .eq('id', eventId)
          .in('organiser_id', ids)
          .maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      async list() {
        let query = client
          .from('tickets')
          .select(
            'id,attendee_name,attendee_email,display_code,status,issued_at,order_items(ticket_types(name))',
            { count: 'exact' },
          )
          .eq('event_id', params.eventId)
          .neq('claim_state', 'UNCLAIMED');
        if (params.status) query = query.eq('status', params.status);
        if (params.search)
          query = query.ilike(
            params.field,
            literalSearchPattern(params.search),
          );
        const offset = (params.page - 1) * attendeePageSize;
        const { data, error, count } = await query
          .order('attendee_name')
          .order('id')
          .range(offset, offset + attendeePageSize - 1);
        if (error) throw error;
        const first = <T>(value: T | T[] | null): T | null =>
          Array.isArray(value) ? value[0] : value;
        const orderIds: string[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data: orders, error: ordersError } = await client
            .from('orders')
            .select('id')
            .eq('event_id', params.eventId)
            .in('status', ['paid', 'partially_refunded', 'refunded'])
            .order('id')
            .range(offset, offset + 999);
          if (ordersError) throw ordersError;
          orderIds.push(...(orders || []).map((order) => order.id));
          if ((orders?.length || 0) < 1000) break;
        }
        const groups = await getOrderGroupBookings(orderIds);
        return {
          groups: groups.map(
            ({
              id,
              ticketName,
              buyerName,
              admissions,
              registered,
              remaining,
              checkedIn,
            }) => ({
              id,
              ticketName,
              buyerName,
              admissions,
              registered,
              remaining,
              checkedIn,
            }),
          ),
          attendees: (data || []).map(({ order_items, ...ticket }) => ({
            ...ticket,
            ticketType:
              first(first(order_items)?.ticket_types || null)?.name ||
              'Admission',
          })),
          total: count || 0,
          page: params.page,
          pageSize: attendeePageSize,
        };
      },
    });
    return respond(
      'data' in result ? result.data : { error: result.error },
      result.status,
    );
  } catch (error) {
    console.error('Unable to load organiser attendees', error);
    return respond(
      { error: 'We could not load attendees. Please try again.' },
      500,
    );
  }
}
