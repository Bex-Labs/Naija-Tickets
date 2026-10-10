import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  buildTicketEmail,
  ticketEventTiming,
  type TicketEmailItem,
} from '@/lib/ticket-email';
import {
  renderTicketEmailArtwork,
  type TicketEmailArtworkRequest,
} from '@/lib/ticket-email-artwork';
import { formatNaira } from '@/lib/events';
import { ticketEmailOrigin } from './ticket-email-config.ts';
export { ticketEmailConfigured } from './ticket-email-config.ts';

type DeliveryClaim = {
  outcome: string;
  delivery_id: string | null;
  recipient_email: string | null;
  order_reference: string | null;
  event_title: string | null;
  event_date: string | null;
  event_venue: string | null;
  event_city: string | null;
  event_address: string | null;
  event_timezone: string | null;
  event_timezone_label: string | null;
  tickets: TicketEmailItem[] | null;
  total_kobo: number | string;
  currency: string;
  paid_at: string | null;
};

type Relation<T> = T | T[] | null;

function first<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] : value;
}

async function ticketArtworkRequests(
  orderId: string,
  claim: DeliveryClaim,
): Promise<TicketEmailArtworkRequest[]> {
  if (
    !claim.order_reference ||
    !claim.event_title ||
    !claim.event_date ||
    !claim.event_venue ||
    !claim.event_city ||
    !claim.event_address ||
    !claim.event_timezone ||
    !claim.event_timezone_label ||
    !claim.tickets?.length
  ) {
    throw new Error('Ticket artwork details are incomplete.');
  }

  const admin = getSupabaseAdminClient();
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('event_id')
    .eq('id', orderId)
    .single();
  if (orderError) throw orderError;

  const [eventResult, itemsResult] = await Promise.all([
    admin
      .from('events')
      .select('presenter_line,categories(name),organisers(name)')
      .eq('id', order.event_id)
      .single(),
    admin
      .from('order_items')
      .select('id,unit_price_kobo,admissions_per_ticket,ticket_types(name)')
      .eq('order_id', orderId),
  ]);
  if (eventResult.error) throw eventResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const event = eventResult.data as unknown as {
    presenter_line: string | null;
    categories: Relation<{ name: string }>;
    organisers: Relation<{ name: string }>;
  };
  const items = (itemsResult.data || []) as unknown as Array<{
    id: string;
    unit_price_kobo: string | number;
    admissions_per_ticket: number;
    ticket_types: Relation<{ name: string }>;
  }>;
  if (!items.length) throw new Error('Ticket price details are missing.');

  const { data: storedTickets, error: ticketsError } = await admin
    .from('tickets')
    .select('display_code,order_item_id')
    .in(
      'order_item_id',
      items.map((item) => item.id),
    )
    .not('display_code', 'is', null);
  if (ticketsError) throw ticketsError;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemByCode = new Map(
    (
      (storedTickets || []) as Array<{
        display_code: string;
        order_item_id: string;
      }>
    ).map((ticket) => [
      ticket.display_code,
      itemById.get(ticket.order_item_id),
    ]),
  );
  const registered = claim.tickets.filter(
    (ticket): ticket is TicketEmailItem & { display_code: string } =>
      Boolean(ticket.display_code),
  );
  const timing = ticketEventTiming(claim.event_date, claim.event_timezone);
  const organiser = first(event.organisers)?.name || 'Independent organiser';

  return registered.map((ticket, index) => {
    const item = itemByCode.get(ticket.display_code);
    if (!item) throw new Error('A ticket price could not be matched.');
    const admissions = item.admissions_per_ticket || 1;
    return {
      eventTitle: claim.event_title as string,
      category: first(event.categories)?.name || 'Event',
      presenter: event.presenter_line || `${organiser} presents`,
      date: timing.date,
      time: `${timing.time} ${claim.event_timezone_label}`,
      venue: `${claim.event_venue}, ${claim.event_city}`,
      address: claim.event_address as string,
      ticketType: ticket.ticket_type,
      attendeeName: ticket.attendee_name || 'Guest',
      price: formatNaira(Number(item.unit_price_kobo)),
      priceLabel: admissions > 1 ? 'Group package price' : 'Unit price',
      displayCode: ticket.display_code,
      orderReference: claim.order_reference as string,
      position: `Ticket ${index + 1} of ${registered.length}`,
    };
  });
}

async function deliverOrderTicketsAttempt(orderId: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc('claim_ticket_delivery_v3', {
    p_order_id: orderId,
  });
  if (error) throw error;
  const claim = (Array.isArray(data) ? data[0] : data) as
    | DeliveryClaim
    | undefined;
  if (!claim || claim.outcome !== 'send') {
    return claim?.outcome || 'not_ready';
  }
  if (!claim.delivery_id) {
    throw new Error('Ticket delivery details are incomplete.');
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  try {
    if (!apiKey || !from) {
      throw new Error('Ticket email delivery is not configured.');
    }
    if (
      !claim.recipient_email ||
      !claim.order_reference ||
      !claim.event_title ||
      !claim.event_date ||
      !claim.event_venue ||
      !claim.event_city ||
      !claim.event_address ||
      !claim.event_timezone ||
      !claim.event_timezone_label ||
      !claim.tickets?.length
    ) {
      throw new Error('Ticket delivery details are incomplete.');
    }
    const ticketImages = await renderTicketEmailArtwork(
      await ticketArtworkRequests(orderId, claim),
    );
    const email = buildTicketEmail(
      {
        orderReference: claim.order_reference,
        eventTitle: claim.event_title,
        eventDate: claim.event_date,
        eventVenue: claim.event_venue,
        eventCity: claim.event_city,
        eventAddress: claim.event_address,
        eventTimezone: claim.event_timezone,
        eventTimezoneLabel: claim.event_timezone_label,
        tickets: claim.tickets,
        totalKobo: Number(claim.total_kobo),
        currency: claim.currency,
        paidAt: claim.paid_at,
      },
      ticketEmailOrigin(),
      ticketImages,
    );

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [claim.recipient_email],
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
      }),
    });
    const result = (await response.json()) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok || !result.id) {
      throw new Error(
        result.error?.message || result.message || 'Ticket email failed.',
      );
    }

    const { error: completionError } = await admin.rpc(
      'complete_ticket_delivery',
      {
        p_delivery_id: claim.delivery_id,
        p_success: true,
        p_provider_message_id: result.id,
        p_error: null,
      },
    );
    if (completionError) throw completionError;
    return 'sent';
  } catch (deliveryError) {
    const message =
      deliveryError instanceof Error
        ? deliveryError.message
        : 'Ticket email failed.';
    const { error: completionError } = await admin.rpc(
      'complete_ticket_delivery',
      {
        p_delivery_id: claim.delivery_id,
        p_success: false,
        p_provider_message_id: null,
        p_error: message,
      },
    );
    if (completionError) {
      console.error('Ticket delivery state update failed', completionError);
    }
    console.error('Ticket email delivery failed', deliveryError);
    return 'failed';
  }
}

export async function deliverOrderTickets(orderId: string) {
  try {
    return await deliverOrderTicketsAttempt(orderId);
  } catch (error) {
    console.error('Ticket delivery could not be claimed', error);
    return 'failed';
  }
}
