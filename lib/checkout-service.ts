import {
  MAX_CHECKOUT_TICKET_TYPES,
  MAX_CHECKOUT_ADMISSIONS,
  UUID_PATTERN,
  validReservationItem,
} from './checkout-reservation-validation.ts';
import { promoCodePattern } from './promo-codes.ts';
import { sha256Hex } from './paystack.ts';
export class CheckoutReservationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export type CheckoutAttendee = { name: string; email: string; phone: string };
export type ReservationInput = {
  eventId: string;
  items: {
    ticketTypeId: string;
    quantity: number;
    attendees: CheckoutAttendee[];
  }[];
  purchaser: CheckoutAttendee;
  promoCode: string;
};
export type CheckoutReservation = {
  orderId: string;
  reference: string;
  expiresAt: string;
  subtotalKobo: number;
  discountKobo: number;
  promoCode: string | null;
  feeKobo: number;
  totalKobo: number;
  checkoutToken: string;
};
export function parseReservationInput(value: unknown): ReservationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CheckoutReservationError('Invalid request.');
  const row = value as Record<string, unknown>;
  const promo =
    typeof row.promoCode === 'string' ? row.promoCode.trim().toUpperCase() : '';
  if (
    (row.promoCode !== undefined && typeof row.promoCode !== 'string') ||
    (promo && !promoCodePattern.test(promo))
  )
    throw new CheckoutReservationError('Invalid Promo Code');
  if (
    typeof row.eventId !== 'string' ||
    !UUID_PATTERN.test(row.eventId) ||
    !Array.isArray(row.items)
  )
    throw new CheckoutReservationError('Invalid request.');
  const purchaser =
    row.purchaser && typeof row.purchaser === 'object'
      ? (row.purchaser as Record<string, unknown>)
      : {};
  if (
    typeof purchaser.name !== 'string' ||
    purchaser.name.trim().length < 2 ||
    purchaser.name.trim().length > 120 ||
    typeof purchaser.email !== 'string' ||
    purchaser.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaser.email.trim()) ||
    typeof purchaser.phone !== 'string' ||
    purchaser.phone.trim().length < 7 ||
    purchaser.phone.trim().length > 40
  )
    throw new CheckoutReservationError(
      'Check the buyer’s name, email and phone number.',
    );
  if (!row.items.length || row.items.length > MAX_CHECKOUT_TICKET_TYPES)
    throw new CheckoutReservationError(
      'Choose at least one valid ticket type.',
    );
  if (
    row.items.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.ticketTypeId !== 'string' ||
        !UUID_PATTERN.test(item.ticketTypeId),
    )
  )
    throw new CheckoutReservationError(
      'Check the ticket quantities and attendee details.',
    );
  // Shapes/quantities/ordinary attendee counts are validated against real types below.
  return {
    eventId: row.eventId.toLowerCase(),
    items: row.items.map((item) => ({
      quantity: item.quantity,
      attendees: item.attendees,
      ticketTypeId: item.ticketTypeId.toLowerCase(),
    })),
    purchaser: {
      name: purchaser.name.trim(),
      email: purchaser.email.trim().toLowerCase(),
      phone: purchaser.phone.trim(),
    },
    promoCode: promo,
  };
}
export function validateReservationTypes(
  input: ReservationInput,
  sizes: Map<string, number>,
) {
  if (
    new Set(input.items.map((item) => item.ticketTypeId)).size !==
      input.items.length ||
    input.items.some(
      (item) =>
        !sizes.has(item.ticketTypeId) ||
        !validReservationItem(item, sizes.get(item.ticketTypeId)),
    ) ||
    input.items.reduce(
      (sum, item) => sum + item.quantity * (sizes.get(item.ticketTypeId) ?? 1),
      0,
    ) > MAX_CHECKOUT_ADMISSIONS
  )
    throw new CheckoutReservationError(
      'Check the ticket quantities and individual attendee details (maximum 400 admissions per checkout).',
    );
}
export function reservationRpcInput(
  input: ReservationInput,
  userId: string | null,
  hash: string,
) {
  return {
    p_promo_code: input.promoCode || null,
    p_customer_id: userId,
    p_event_id: input.eventId,
    p_items: input.items.map((item) => ({
      ticket_type_id: item.ticketTypeId,
      quantity: item.quantity,
      attendees: item.attendees,
    })),
    p_purchaser: input.purchaser,
    p_checkout_token_hash: hash,
  };
}
export function projectReservation(
  row: Record<string, unknown>,
  token: string,
): CheckoutReservation {
  const money = (value: unknown) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new CheckoutReservationError(
        'The stored booking total is invalid.',
        503,
      );
    return n;
  };
  return {
    orderId: String(row.order_id),
    reference: String(row.reference),
    expiresAt: String(row.expires_at),
    subtotalKobo: money(row.subtotal_kobo),
    discountKobo: money(row.discount_kobo),
    promoCode: typeof row.promo_code === 'string' ? row.promo_code : null,
    feeKobo: money(row.fee_kobo),
    totalKobo: money(row.total_kobo),
    checkoutToken: token,
  };
}
export function reservationFailure(cause: unknown): CheckoutReservationError {
  if (cause instanceof CheckoutReservationError) return cause;
  const message =
    cause && typeof cause === 'object' && 'message' in cause
      ? String(cause.message)
      : '';
  if (message === 'Promo code is not available for this event.')
    return new CheckoutReservationError('Invalid Promo Code', 409);
  const safe =
    message.startsWith('Promo code ') ||
    message.startsWith('Only ') ||
    message.includes('availability') ||
    message.includes('not available') ||
    message.includes('sales');
  return new CheckoutReservationError(
    safe
      ? message
      : 'Tickets could not be reserved. Refresh the event and try again.',
    409,
  );
}
export function createCheckoutToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function reservationPayloadHash(
  input: ReservationInput,
  userId: string | null,
) {
  return sha256Hex(
    JSON.stringify({
      customerId: userId,
      eventId: input.eventId,
      items: [...input.items].sort((a, b) =>
        a.ticketTypeId.localeCompare(b.ticketTypeId),
      ),
      purchaser: input.purchaser,
      promoCode: input.promoCode,
    }),
  );
}
