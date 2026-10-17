import { popupUrl } from './checkout-popup.ts';
import { IntegrationError } from './errors.ts';
import {
  integrationApiHandler,
  type IntegrationApiDependencies,
  type IntegrationAuthProof,
} from './api.ts';
import {
  integrationId,
  readIntegrationJson,
  canonicalIntegrationOrigin,
} from './validation.ts';
import {
  hostedSecretDigest,
  hostedSessionSecret,
  type CheckoutSigningKeys,
  type HostedSessionIdentity,
} from './checkout-access.ts';
import type { IntegrationContext } from './types.ts';
import { promoCodePattern } from '../promo-codes.ts';

export type CheckoutIntent = {
  event_id: string;
  items: { ticket_type_id: string; quantity: number }[];
  promo_code: string | null;
  return_url: string;
  cancel_url: string;
};
export type StoredCheckoutSession = HostedSessionIdentity & {
  event_id: string;
  integration_id: string;
  status: string;
  currency: 'NGN';
  admissions: number;
  subtotal_kobo: number | null;
  discount_kobo: number | null;
  fee_kobo: number | null;
  total_kobo: number | null;
  reservation_expires_at: string | null;
  tickets_issued: number;
  members_registered: number;
  capability_hash: string;
};
export type CheckoutSessionDependencies = {
  popupEnabled?(): boolean;
  signingKeys(): CheckoutSigningKeys;
  requireConfiguration(context: IntegrationContext): void;
  origin(request: Request): string;
  create(
    this: void,
    proof: IntegrationAuthProof,
    input: {
      intent: CheckoutIntent;
      idempotencyDigest: string;
      payloadHash: string;
      session: HostedSessionIdentity;
      accessHash: string;
      reservationHash: string;
    },
  ): Promise<StoredCheckoutSession>;
  status(
    this: void,
    proof: IntegrationAuthProof,
    id: string,
  ): Promise<StoredCheckoutSession>;
};
const invalid = (message: string): never => {
  throw new IntegrationError(400, 'INVALID_REQUEST', message);
};
function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('Send a valid checkout configuration.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key)))
    return invalid(
      'Use only documented checkout fields. Prices and customer IDs must not be supplied.',
    );
  return row;
}
export function checkoutReturnUrl(
  value: unknown,
  context: Pick<IntegrationContext, 'environment'>,
) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    Array.from(value).some((char) => char.charCodeAt(0) < 33) ||
    /[\\%?#]/.test(value)
  )
    return invalid(
      'Use a registered website URL with a simple path and no query, fragment or credentials.',
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid('Enter a valid return website address.');
  }
  canonicalIntegrationOrigin(url.origin, context.environment);
  if (url.username || url.password || url.pathname.startsWith('//'))
    return invalid('Use a registered return website without credentials.');
  return url.toString();
}
export function parseCheckoutIntent(
  value: unknown,
  context: Pick<IntegrationContext, 'environment'>,
): CheckoutIntent {
  const row = object(value, [
    'event_id',
    'items',
    'promo_code',
    'return_url',
    'cancel_url',
  ]);
  if (!Array.isArray(row.items) || !row.items.length || row.items.length > 20)
    return invalid('Choose 1 to 20 ticket types.');
  const items = row.items
    .map((value) => {
      const item = object(value, ['ticket_type_id', 'quantity']);
      if (
        typeof item.quantity !== 'number' ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 20
      )
        return invalid('Choose 1 to 20 packages of each ticket type.');
      return {
        ticket_type_id: integrationId(item.ticket_type_id),
        quantity: item.quantity,
      };
    })
    .sort((a, b) => a.ticket_type_id.localeCompare(b.ticket_type_id));
  if (new Set(items.map((item) => item.ticket_type_id)).size !== items.length)
    return invalid('Select each ticket type once.');
  const promo =
    row.promo_code === undefined || row.promo_code === null
      ? ''
      : typeof row.promo_code === 'string'
        ? row.promo_code.trim().toUpperCase()
        : invalid('Enter a valid promo code.');
  if (promo && !promoCodePattern.test(promo))
    return invalid('Invalid Promo Code');
  return {
    event_id: integrationId(row.event_id),
    items,
    promo_code: promo || null,
    return_url: checkoutReturnUrl(row.return_url, context),
    cancel_url: checkoutReturnUrl(row.cancel_url ?? row.return_url, context),
  };
}
export function checkoutIdempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key');
  if (!value || !/^[A-Za-z0-9_.-]{8,128}$/.test(value))
    return invalid(
      'Supply an Idempotency-Key with 8 to 128 letters, numbers, dots, underscores or hyphens.',
    );
  return value;
}
export function projectCheckoutSession(row: StoredCheckoutSession) {
  if (
    !row ||
    ![
      'open',
      'cancelled',
      'reserved',
      'pending',
      'paid',
      'failed',
      'expired',
      'refunded',
      'partially_refunded',
    ].includes(row.status) ||
    ![row.admissions, row.tickets_issued, row.members_registered].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    ![row.subtotal_kobo, row.discount_kobo, row.fee_kobo, row.total_kobo].every(
      (n) => n === null || (Number.isSafeInteger(n) && n >= 0),
    )
  )
    throw new IntegrationError(
      503,
      'INTEGRATIONS_UNAVAILABLE',
      'Checkout information is temporarily unavailable.',
    );
  return {
    id: row.id,
    event_id: row.event_id,
    environment: row.environment,
    status: row.status,
    expires_at: row.expires_at,
    reservation_expires_at: row.reservation_expires_at,
    currency: row.currency,
    admissions: row.admissions,
    subtotal_kobo: row.subtotal_kobo,
    discount_kobo: row.discount_kobo,
    fee_kobo: row.fee_kobo,
    total_kobo: row.total_kobo,
    tickets_issued: row.tickets_issued,
    members_registered: row.members_registered,
  };
}
export function createCheckoutSessionHandler(
  api: IntegrationApiDependencies,
  checkout: CheckoutSessionDependencies,
) {
  return integrationApiHandler(
    api,
    'checkout:write',
    'checkout.create',
    async (context, request, proof) => {
      if (new URL(request.url).search)
        return invalid('Checkout creation accepts no query parameters.');
      const idempotency = checkoutIdempotencyKey(request);
      const intent = parseCheckoutIntent(
        await readIntegrationJson(request),
        context,
      );
      checkout.requireConfiguration(context);
      const signing = checkout.signingKeys();
      const session: HostedSessionIdentity = {
        id: crypto.randomUUID(),
        environment: context.environment,
        expires_at: new Date(
          Math.min(Date.now() + 30 * 60_000, Date.parse(context.expiresAt)),
        ).toISOString(),
        signing_key_version: signing.activeVersion,
      };
      const access = await hostedSessionSecret(session, 'access', signing),
        reservation = await hostedSessionSecret(
          session,
          'reservation',
          signing,
        );
      const stored = await checkout.create(proof, {
        intent,
        idempotencyDigest: await hostedSecretDigest(idempotency),
        payloadHash: await hostedSecretDigest(JSON.stringify(intent)),
        session,
        accessHash: await hostedSecretDigest(access),
        reservationHash: await hostedSecretDigest(reservation),
      });
      const recoveredAccess = await hostedSessionSecret(
        stored,
        'access',
        signing,
      );
      if (
        (await hostedSecretDigest(recoveredAccess)) !== stored.capability_hash
      )
        throw new IntegrationError(
          503,
          'CHECKOUT_NOT_CONFIGURED',
          'The checkout signing configuration has changed. Contact support.',
        );
      const url = new URL(
        `/integrations/checkout/${stored.id}`,
        checkout.origin(request),
      );
      url.searchParams.set('access', recoveredAccess);
      return {
        ...projectCheckoutSession(stored),
        checkout_url: url.toString(),
        ...(checkout.popupEnabled?.() &&
        Date.parse(stored.expires_at) > Date.now()
          ? {
              popup_url: await popupUrl(
                stored,
                recoveredAccess,
                new URL(intent.return_url).origin,
                checkout.origin(request),
                signing,
              ),
            }
          : {}),
      };
    },
    false,
    'POST',
  );
}
export function checkoutSessionStatusHandler(
  api: IntegrationApiDependencies,
  checkout: CheckoutSessionDependencies,
  id: string,
) {
  return integrationApiHandler(
    api,
    'orders:read',
    'checkout.status',
    async (_context, request, proof) => {
      if (new URL(request.url).search)
        return invalid('Checkout status accepts no query parameters.');
      return projectCheckoutSession(
        await checkout.status(proof, integrationId(id)),
      );
    },
  );
}
