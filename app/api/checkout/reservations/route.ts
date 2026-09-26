import { NextResponse } from 'next/server';
import {
  MAX_CHECKOUT_TICKET_TYPES,
  MAX_CHECKOUT_ADMISSIONS,
  UUID_PATTERN,
  validReservationItem,
} from '@/lib/checkout-reservation-validation';
import { promoCodePattern } from '@/lib/promo-codes';
import { sha256Hex } from '@/lib/paystack';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

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
    promoCode?: unknown;
  };
  const promoCode =
    typeof values.promoCode === 'string'
      ? values.promoCode.trim().toUpperCase()
      : '';
  if (
    (values.promoCode !== undefined && typeof values.promoCode !== 'string') ||
    (promoCode && !promoCodePattern.test(promoCode))
  ) {
    return NextResponse.json({ error: 'Invalid Promo Code' }, { status: 400 });
  }
  if (
    typeof values.eventId !== 'string' ||
    !UUID_PATTERN.test(values.eventId) ||
    !Array.isArray(values.items)
  ) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!validPurchaser(values.purchaser)) {
    return NextResponse.json(
      { error: 'Check the buyer’s name, email and phone number.' },
      { status: 400 },
    );
  }
  if (!values.items.length || values.items.length > MAX_CHECKOUT_TICKET_TYPES) {
    return NextResponse.json(
      { error: 'Choose at least one valid ticket type.' },
      { status: 400 },
    );
  }
  const items = values.items as ReservationItem[];
  if (
    items.some(
      (item) =>
        !item ||
        typeof item.ticketTypeId !== 'string' ||
        !UUID_PATTERN.test(item.ticketTypeId),
    )
  ) {
    return NextResponse.json(
      { error: 'Check the ticket quantities and attendee details.' },
      { status: 400 },
    );
  }

  try {
    const client = getSupabaseAdminClient();
    const { data: types, error: typesError } = await client
      .from('ticket_types')
      .select('id,admissions_per_ticket')
      .eq('event_id', values.eventId)
      .in(
        'id',
        items.map((item) => item.ticketTypeId as string),
      );
    if (typesError) throw typesError;
    const sizeById = new Map(
      (types || []).map((type) => [
        type.id,
        type.admissions_per_ticket as number,
      ]),
    );
    if (
      items.some(
        (item) =>
          !sizeById.has(item.ticketTypeId) ||
          !validReservationItem(item, sizeById.get(item.ticketTypeId)),
      ) ||
      items.reduce(
        (total, item) =>
          total +
          Number(item.quantity) * (sizeById.get(item.ticketTypeId) || 1),
        0,
      ) > MAX_CHECKOUT_ADMISSIONS
    ) {
      return NextResponse.json(
        {
          error:
            'Check the ticket quantities and individual attendee details (maximum 400 admissions per checkout).',
        },
        { status: 400 },
      );
    }
    const checkoutToken = createCheckoutToken();
    const checkoutTokenHash = await sha256Hex(checkoutToken);
    const { data, error } = await client.rpc('create_checkout_reservation_v3', {
      p_promo_code: promoCode || null,
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
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Reservation was not created.');
    return NextResponse.json({
      reservation: {
        orderId: row.order_id,
        reference: row.reference,
        expiresAt: row.expires_at,
        subtotalKobo: Number(row.subtotal_kobo),
        discountKobo: Number(row.discount_kobo),
        promoCode: row.promo_code,
        feeKobo: Number(row.fee_kobo),
        totalKobo: Number(row.total_kobo),
        checkoutToken,
      },
    });
  } catch (error) {
    console.error('Checkout reservation failed', error);
    const message =
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message
        : '';
    if (message === 'Promo code is not available for this event.') {
      return NextResponse.json(
        { error: 'Invalid Promo Code' },
        { status: 409 },
      );
    }
    const safeMessage =
      message.startsWith('Promo code ') ||
      message.includes('availability') ||
      message.includes('not available') ||
      message.includes('sales')
        ? message
        : 'Tickets could not be reserved. Refresh the event and try again.';
    return NextResponse.json({ error: safeMessage }, { status: 409 });
  }
}
