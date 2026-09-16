import { NextResponse } from 'next/server';
import { sha256Hex } from '@/lib/paystack';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReservationItem = {
  ticketTypeId?: unknown;
  quantity?: unknown;
  attendees?: unknown;
};

type Purchaser = { name?: unknown; email?: unknown; phone?: unknown };

function validPurchaser(value: unknown): value is {
  name: string;
  email: string;
  phone: string;
} {
  if (!value || typeof value !== 'object') return false;
  const purchaser = value as Purchaser;
  return (
    typeof purchaser.name === 'string' &&
    purchaser.name.trim().length >= 2 &&
    purchaser.name.trim().length <= 120 &&
    typeof purchaser.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaser.email.trim()) &&
    typeof purchaser.phone === 'string' &&
    purchaser.phone.trim().length >= 7 &&
    purchaser.phone.trim().length <= 40
  );
}

function createCheckoutToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function validAttendees(value: unknown, quantity: number) {
  if (!Array.isArray(value) || value.length !== quantity) return false;
  return value.every((attendee) => {
    if (!attendee || typeof attendee !== 'object') return false;
    const fields = attendee as Record<string, unknown>;
    return (
      typeof fields.name === 'string' &&
      fields.name.trim().length >= 2 &&
      fields.name.trim().length <= 120 &&
      typeof fields.email === 'string' &&
      fields.email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim()) &&
      typeof fields.phone === 'string' &&
      fields.phone.trim().length >= 7 &&
      fields.phone.trim().length <= 40
    );
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const values = body as {
    eventId?: unknown;
    items?: unknown;
    purchaser?: unknown;
  };
  if (
    typeof values.eventId !== 'string' ||
    !UUID_PATTERN.test(values.eventId) ||
    !Array.isArray(values.items) ||
    !validPurchaser(values.purchaser)
  ) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!values.items.length || values.items.length > 10) {
    return NextResponse.json(
      { error: 'Choose at least one valid ticket type.' },
      { status: 400 },
    );
  }
  const items = values.items as ReservationItem[];
  const valid = items.every(
    (item) =>
      typeof item.ticketTypeId === 'string' &&
      UUID_PATTERN.test(item.ticketTypeId) &&
      Number.isSafeInteger(item.quantity) &&
      Number(item.quantity) > 0 &&
      Number(item.quantity) <= 6 &&
      validAttendees(item.attendees, Number(item.quantity)),
  );
  if (!valid) {
    return NextResponse.json(
      { error: 'Check the ticket quantities and attendee details.' },
      { status: 400 },
    );
  }

  try {
    const checkoutToken = createCheckoutToken();
    const checkoutTokenHash = await sha256Hex(checkoutToken);
    const { data, error } = await getSupabaseAdminClient().rpc(
      'create_checkout_reservation_v2',
      {
        p_customer_id: user?.id || null,
        p_event_id: values.eventId,
        p_items: items.map((item) => ({
          ticket_type_id: item.ticketTypeId,
          quantity: item.quantity,
          attendees: item.attendees,
        })),
        p_purchaser: {
          name: values.purchaser.name.trim(),
          email: values.purchaser.email.trim().toLowerCase(),
          phone: values.purchaser.phone.trim(),
        },
        p_checkout_token_hash: checkoutTokenHash,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Reservation was not created.');
    return NextResponse.json({
      reservation: {
        orderId: row.order_id,
        reference: row.reference,
        expiresAt: row.expires_at,
        subtotalKobo: Number(row.subtotal_kobo),
        feeKobo: Number(row.fee_kobo),
        totalKobo: Number(row.total_kobo),
        checkoutToken,
      },
    });
  } catch (error) {
    console.error('Checkout reservation failed', error);
    const message = error instanceof Error ? error.message : '';
    const safeMessage =
      message.includes('availability') ||
      message.includes('not available') ||
      message.includes('sales')
        ? message
        : 'Tickets could not be reserved. Refresh the event and try again.';
    return NextResponse.json({ error: safeMessage }, { status: 409 });
  }
}
