import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  groupCounts,
  GROUP_TOKEN_PATTERN,
  type GroupBooking,
  type GroupMember,
} from '@/lib/group-bookings';

function batches<T>(values: T[], size = 50): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

// Supabase limits a response to 1,000 records. Page slots so large bookings never
// report incomplete member lists or registration totals.
async function allRows<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await query(offset, offset + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data?.length || 0) < 1000) return rows;
  }
}

// Called only after the existing order/customer/organiser access checks.
export async function getOrderGroupBookings(
  orderIds: string[],
): Promise<GroupBooking[]> {
  if (!orderIds.length) return [];
  const client = getSupabaseAdminClient();
  const items = (
    await Promise.all(
      batches(orderIds).map((ids) =>
        allRows((from, to) =>
          client
            .from('order_items')
            .select('id,orders(purchaser_name),ticket_types(name)')
            .in('order_id', ids)
            .eq('group_claim_required', true)
            .order('id')
            .range(from, to),
        ),
      ),
    )
  ).flat();
  const itemIds = items.map((item) => item.id);
  if (!itemIds.length) return [];
  const bookings = (
    await Promise.all(
      batches(itemIds).map((ids) =>
        allRows((from, to) =>
          client
            .from('group_bookings')
            .select('id,order_item_id,admissions,invite_token')
            .in('order_item_id', ids)
            .order('id')
            .range(from, to),
        ),
      ),
    )
  ).flat();
  if (!bookings.length) return [];
  const slots = (
    await Promise.all(
      batches(bookings.map((booking) => booking.id)).map((ids) =>
        allRows((from, to) =>
          client
            .from('tickets')
            .select(
              'id,group_booking_id,attendee_name,claim_state,status,attendee_index',
            )
            .in('group_booking_id', ids)
            .order('attendee_index')
            .order('id')
            .range(from, to),
        ),
      ),
    )
  ).flat();
  const first = <T>(value: T | T[] | null) =>
    Array.isArray(value) ? value[0] : value;
  return bookings.map((booking) => {
    const item = items?.find((value) => value.id === booking.order_item_id);
    const members = (slots || [])
      .filter((slot) => slot.group_booking_id === booking.id)
      .map(
        (slot): GroupMember => ({
          id: slot.id,
          name: slot.attendee_name,
          state: slot.claim_state,
          status: slot.status,
        }),
      );
    return {
      id: booking.id,
      orderItemId: booking.order_item_id,
      ticketName: first(item?.ticket_types || null)?.name || 'Group ticket',
      buyerName: first(item?.orders || null)?.purchaser_name || 'Buyer',
      admissions: booking.admissions,
      ...groupCounts(members),
      invitePath: `/groups/${booking.invite_token}`,
      members,
    };
  });
}

export async function getPublicGroupInvitation(token: string) {
  if (!GROUP_TOKEN_PATTERN.test(token)) return null;
  const client = getSupabaseAdminClient();
  const { data: booking, error } = await client
    .from('group_bookings')
    .select('id,admissions,order_item_id')
    .eq('invite_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;
  const { data: item, error: itemError } = await client
    .from('order_items')
    .select('order_id,ticket_types(name,description)')
    .eq('id', booking.order_item_id)
    .single();
  if (itemError) throw itemError;
  const { data: order, error: orderError } = await client
    .from('orders')
    .select('status,event_id')
    .eq('id', item.order_id)
    .single();
  if (orderError) throw orderError;
  if (!['paid', 'partially_refunded'].includes(order.status)) return null;
  const [
    { data: event, error: eventError },
    { count: remaining, error: countError },
    { count: verified, error: paymentError },
  ] = await Promise.all([
    client
      .from('events')
      .select(
        'title,starts_at,ends_at,timezone,timezone_label,venue_name,city,status',
      )
      .eq('id', order.event_id)
      .single(),
    client
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('group_booking_id', booking.id)
      .eq('claim_state', 'UNCLAIMED')
      .eq('status', 'valid'),
    client
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', item.order_id)
      .eq('status', 'verified'),
  ]);
  if (eventError || countError || paymentError)
    throw eventError || countError || paymentError;
  if (
    !event ||
    !verified ||
    event.status !== 'published' ||
    new Date(event.ends_at).getTime() <= Date.now()
  )
    return null;
  const tier = Array.isArray(item.ticket_types)
    ? item.ticket_types[0]
    : item.ticket_types;
  // Never expose buyer details, order references, members, ticket codes or receipt tokens.
  return {
    eventTitle: event.title,
    ticketName: tier?.name || 'Group ticket',
    description: tier?.description || '',
    admissions: booking.admissions,
    remaining: remaining || 0,
    startsAt: event.starts_at,
    timezone: event.timezone || 'Africa/Lagos',
    timezoneLabel: event.timezone_label || 'WAT',
    venue: `${event.venue_name}, ${event.city}`,
  };
}
