import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { buildTicketEmail, type TicketEmailItem } from '@/lib/ticket-email';

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

function configuredAppOrigin() {
  const value = process.env.APP_URL?.trim();
  if (!value) throw new Error('APP_URL is required for ticket email links.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'A public HTTPS APP_URL is required so customers can open emailed tickets.',
    );
  }
  return url.origin;
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

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
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
      configuredAppOrigin(),
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

export function ticketEmailConfigured() {
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_FROM?.trim())
    return false;
  try {
    configuredAppOrigin();
    return true;
  } catch {
    return false;
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
