import {
  retrieveTicketOrder,
  type StoredIssuedTicket,
  type StoredTicketEvent,
  type StoredTicketOrder,
  type StoredTicketOrderItem,
  type TicketOrderSource,
} from '@/lib/order-ticket-access';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

type Relation<T> = T | T[] | null;

function first<T>(relation: Relation<T>) {
  return Array.isArray(relation) ? relation[0] : relation;
}

const supabaseTicketOrderSource: TicketOrderSource = {
  async findOrder(reference): Promise<StoredTicketOrder | null> {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('orders')
      .select('id,reference,status,currency,event_id')
      .eq('reference', reference)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('status')
      .eq('order_id', data.id)
      .eq('status', 'verified')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError) throw paymentError;
    return {
      ...(data as StoredTicketOrder),
      paymentStatus: payment?.status,
    };
  },

  async findEvent(eventId): Promise<StoredTicketEvent | null> {
    const { data, error } = await getSupabaseAdminClient()
      .from('events')
      .select(
        'title,presenter_line,starts_at,timezone,timezone_label,venue_name,city,address,categories(name),organisers(name)',
      )
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as unknown as {
      title: string;
      presenter_line: string | null;
      starts_at: string;
      timezone: string;
      timezone_label: string | null;
      venue_name: string;
      city: string;
      address: string;
      categories: Relation<{ name: string }>;
      organisers: Relation<{ name: string }>;
    };
    const organiser = first(row.organisers)?.name || 'Independent organiser';
    return {
      title: row.title,
      presenterLine: row.presenter_line || `${organiser} presents`,
      category: first(row.categories)?.name || 'Event',
      startsAt: row.starts_at,
      timezone: row.timezone || 'Africa/Lagos',
      timezoneLabel: row.timezone_label || 'WAT',
      venue: row.venue_name,
      city: row.city,
      address: row.address,
    };
  },

  async findOrderItems(orderId): Promise<StoredTicketOrderItem[]> {
    const { data, error } = await getSupabaseAdminClient()
      .from('order_items')
      .select('id,unit_price_kobo,ticket_types(name)')
      .eq('order_id', orderId);
    if (error) throw error;
    return (
      (data || []) as unknown as Array<{
        id: string;
        unit_price_kobo: string | number;
        ticket_types: Relation<{ name: string }>;
      }>
    ).map((item) => ({
      id: item.id,
      ticketType: first(item.ticket_types)?.name || 'Admission',
      unitPriceKobo: Number(item.unit_price_kobo),
    }));
  },

  async findIssuedTickets(orderItemIds): Promise<StoredIssuedTicket[]> {
    if (orderItemIds.length === 0) return [];
    const { data, error } = await getSupabaseAdminClient()
      .from('tickets')
      .select(
        'id,order_item_id,attendee_name,display_code,status,issued_at,attendee_index',
      )
      .in('order_item_id', orderItemIds)
      .order('issued_at', { ascending: true })
      .order('attendee_index', { ascending: true });
    if (error) throw error;
    return (
      (data || []) as Array<{
        id: string;
        order_item_id: string;
        attendee_name: string;
        display_code: string;
        status: string;
        issued_at: string;
      }>
    ).map((ticket) => ({
      id: ticket.id,
      orderItemId: ticket.order_item_id,
      attendeeName: ticket.attendee_name,
      displayCode: ticket.display_code,
      status: ticket.status,
      issuedAt: ticket.issued_at,
    }));
  },
};

export function getTicketOrder(reference: string) {
  return retrieveTicketOrder(reference, supabaseTicketOrderSource);
}
