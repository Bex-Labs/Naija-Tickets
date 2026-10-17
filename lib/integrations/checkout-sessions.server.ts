import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
import {
  getSupabaseAdminClient,
  getAuthenticatedUser,
} from '@/lib/supabase/server';
import {
  getTrustedAppOrigin,
  initializePaystackTransaction,
  sha256Hex,
} from '@/lib/paystack';
import {
  parseReservationInput,
  reservationFailure,
  reservationPayloadHash,
  reservationRpcInput,
  type CheckoutReservation,
} from '@/lib/checkout-service';
import { validateStoredReservationTypes } from '@/lib/checkout-service.server';
import { startCheckoutPayment } from '@/lib/payment-start';
import { integrationApiDependencies, integrationRpc } from './store.server.ts';
import { enforceIntegrationLimit } from './api.ts';
import { integrationId, readIntegrationJson } from './validation.ts';
import { IntegrationError } from './errors.ts';
import {
  hostedSessionSecret,
  hostedSecretDigest,
  isHostedSecret,
  validateSigningKeys,
  type CheckoutSigningKeys,
} from './checkout-access.ts';
import {
  integrationResourceMode,
  requireHostedCheckoutConfiguration,
  requireHostedPaymentMode,
} from './resource-mode.ts';
import {
  checkoutReturnUrl,
  type CheckoutSessionDependencies,
  type StoredCheckoutSession,
} from './checkout-sessions.ts';
import type { CheckoutLine } from '@/components/checkout-flow';

export function checkoutSigningKeys(): CheckoutSigningKeys {
  const activeVersion = process.env.INTEGRATIONS_SIGNING_KEY_VERSION ?? 'v1';
  let previous: unknown = {};
  try {
    previous = JSON.parse(
      process.env.INTEGRATIONS_PREVIOUS_SIGNING_KEYS ?? '{}',
    );
  } catch {
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Invalid checkout signing configuration.',
    );
  }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous))
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Invalid checkout signing configuration.',
    );
  const configuration = validateSigningKeys({
    activeVersion,
    keys: {
      ...(previous as Record<string, string>),
      [activeVersion]: process.env.INTEGRATIONS_SIGNING_SECRET ?? '',
    },
  });
  const unrelatedSecrets = [
    process.env.ADMIN_SESSION_SECRET,
    process.env.PAYSTACK_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ].filter(Boolean);
  if (
    Object.values(configuration.keys).some((secret) =>
      unrelatedSecrets.includes(secret),
    )
  )
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Use a dedicated checkout signing secret.',
    );
  return configuration;
}
export const checkoutSessionDependencies: CheckoutSessionDependencies = {
  signingKeys: checkoutSigningKeys,
  requireConfiguration: (context) =>
    requireHostedCheckoutConfiguration(context.environment, process.env),
  origin: (request) => getTrustedAppOrigin(request.url),
  create: async (proof, input) => {
    await verifyIntegrationResourceBinding(proof.environment);
    return integrationRpc('create_hosted_session_v2', {
      p_key_id: proof.keyId,
      p_digest: proof.digest,
      p_environment: proof.environment,
      p_session_id: input.session.id,
      p_event_id: input.intent.event_id,
      p_items: input.intent.items,
      p_promo_code: input.intent.promo_code,
      p_return_url: input.intent.return_url,
      p_cancel_url: input.intent.cancel_url,
      p_idempotency_digest: input.idempotencyDigest,
      p_payload_hash: input.payloadHash,
      p_capability_hash: input.accessHash,
      p_reservation_hash: input.reservationHash,
      p_signing_version: input.session.signing_key_version,
      p_expires_at: input.session.expires_at,
      p_customer: input.intent.customer ?? {},
      p_external_reference: input.intent.external_reference ?? null,
    });
  },
  status: async (proof, id) => {
    await verifyIntegrationResourceBinding(proof.environment);
    return integrationRpc('get_integration_checkout_session', {
      p_key_id: proof.keyId,
      p_digest: proof.digest,
      p_environment: proof.environment,
      p_session_id: id,
    });
  },
};
export type HostedCheckoutView = {
  session: StoredCheckoutSession;
  promo_code: string | null;
  customer: { name?: string; email?: string; phone?: string };
  catalogue: {
    ticket: unknown;
    max_packages: number;
    remaining_packages?: number;
  }[];
  return_url: string | null;
  cancel_url: string | null;
  event: {
    id: string;
    title: string;
    slug: string;
    starts_at: string;
    timezone: string;
    venue_name: string;
    city: string;
    description: string;
    image_url: string | null;
    organiser: { name: string };
  };
  intent: { ticket_type_id: string; quantity: number }[];
  lines: CheckoutLine[];
  reservation: Omit<CheckoutReservation, 'checkoutToken'> | null;
};
export async function getHostedCheckout(
  id: string,
  access: string,
): Promise<HostedCheckoutView> {
  const sessionId = integrationId(id);
  if (!isHostedSecret(access))
    throw new IntegrationError(404, 'NOT_FOUND', 'Checkout link not found.');
  const mode = integrationResourceMode(process.env);
  requireHostedCheckoutConfiguration(mode, process.env);
  checkoutSigningKeys();
  await verifyIntegrationResourceBinding(mode);
  const row = await integrationRpc<HostedCheckoutView>(
    'hosted_checkout_details',
    {
      p_session: sessionId,
      p_access: await hostedSecretDigest(access),
    },
  );
  if (
    !row?.session ||
    row.session.environment !== mode ||
    !Array.isArray(row.lines) ||
    row.lines.some(
      (line) =>
        !Number.isSafeInteger(line.unitPriceKobo) ||
        line.unitPriceKobo < 0 ||
        !Number.isSafeInteger(line.lineTotalKobo) ||
        line.lineTotalKobo < 0,
    )
  )
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'This checkout is temporarily unavailable.',
    );
  return row;
}
// Recovery may reveal only a still-approved public website, never expired
// checkout data or new purchase authority. The original capability is required.
export async function hostedRecoveryReturn(id: string, access: string) {
  if (!isHostedSecret(access)) return null;
  const mode = integrationResourceMode(process.env);
  await verifyIntegrationResourceBinding(mode);
  const { data, error } = await getSupabaseAdminClient()
    .from('integration_checkout_sessions')
    .select(
      'id,integration_id,environment,cancel_url,cancelled_at,expires_at,integrations!inner(status)',
    )
    .eq('id', integrationId(id))
    .eq('capability_hash', await hostedSecretDigest(access))
    .eq('environment', mode)
    .eq('integrations.status', 'active')
    .abortSignal(AbortSignal.timeout(8000))
    .maybeSingle();
  if (error || !data) return null;
  const allowed = await integrationRpc<boolean>('integration_return_allowed', {
    p_integration_id: data.integration_id,
    p_environment: mode,
    p_url: data.cancel_url,
  });
  return allowed
    ? buildIntegrationReturn({
        url: data.cancel_url,
        session_id: data.id,
        environment: mode,
        status: data.cancelled_at
          ? 'cancelled'
          : Date.parse(data.expires_at) <= Date.now()
            ? 'expired'
            : 'open',
      })
    : null;
}
export async function hostedReservation(view: HostedCheckoutView) {
  return view.reservation
    ? {
        ...view.reservation,
        checkoutToken: await hostedSessionSecret(
          view.session,
          'reservation',
          checkoutSigningKeys(),
        ),
      }
    : null;
}
export function buildIntegrationReturn(
  value: {
    url: string | null;
    session_id: string;
    status: string;
    environment?: 'test' | 'live';
  } | null,
) {
  if (!value?.url) return null;
  if (
    ![
      'open',
      'reserved',
      'pending',
      'paid',
      'failed',
      'expired',
      'cancelled',
      'refunded',
      'partially_refunded',
    ].includes(value.status)
  )
    return null;
  const url = new URL(
    checkoutReturnUrl(value.url, {
      environment: value.environment ?? integrationResourceMode(process.env),
    }),
  );
  url.searchParams.set('nt_session', integrationId(value.session_id));
  url.searchParams.set('nt_status', value.status);
  return url.toString();
}
export async function integrationCompletedUrl(
  orderId: string,
  requestUrl = process.env.APP_URL ?? 'http://localhost:3000',
) {
  try {
    const { data: session, error } = await getSupabaseAdminClient()
      .from('integration_checkout_sessions')
      .select('id,environment,expires_at,signing_key_version')
      .eq('order_id', orderId)
      .abortSignal(AbortSignal.timeout(8000))
      .maybeSingle();
    if (error || !session || Date.parse(session.expires_at) <= Date.now())
      return null;
    const target = new URL(
      `/integrations/checkout/${session.id}`,
      getTrustedAppOrigin(requestUrl),
    );
    target.searchParams.set(
      'access',
      await hostedSessionSecret(session, 'access', checkoutSigningKeys()),
    );
    return target.toString();
  } catch {
    return null;
  }
}
export async function integrationReturnForReference(
  reference: string,
  requestUrl?: string,
) {
  if (!/^[a-f0-9]{36}$/i.test(reference)) return null;
  const { data, error } = await getSupabaseAdminClient()
    .from('orders')
    .select('id')
    .eq('reference', reference)
    .not('integration_checkout_session_id', 'is', null)
    .abortSignal(AbortSignal.timeout(8000))
    .maybeSingle();
  if (error || !data) return null;
  return integrationCompletedUrl(data.id, requestUrl);
}
export async function requireAttributedPaymentConfiguration(
  orderId: string,
  token: string,
) {
  const { data, error } = await getSupabaseAdminClient()
    .from('orders')
    .select('integration_checkout_session_id,total_kobo')
    .eq('id', orderId)
    .eq('checkout_token_hash', await sha256Hex(token))
    .abortSignal(AbortSignal.timeout(8000))
    .maybeSingle();
  if (error) throw error;
  if (!data?.integration_checkout_session_id) return;
  const { data: session, error: sessionError } = await getSupabaseAdminClient()
    .from('integration_checkout_sessions')
    .select('environment')
    .eq('id', data.integration_checkout_session_id)
    .abortSignal(AbortSignal.timeout(8000))
    .single();
  if (sessionError) throw sessionError;
  requireHostedCheckoutConfiguration(session.environment, process.env);
  await verifyIntegrationResourceBinding(session.environment);
  if (Number(data.total_kobo) > 0)
    requireHostedPaymentMode(session.environment, process.env);
}
export function hostedCheckoutAction(
  action: 'reserve' | 'pay' | 'cancel' | 'selection',
  scheduleDelivery: (orderId: string) => void,
) {
  return async (request: Request, id: string) => {
    const requestId = crypto.randomUUID();
    const headers: Record<string, string> = {
      'X-Request-ID': requestId,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin, Authorization',
    };
    try {
      await enforceIntegrationLimit(
        integrationApiDependencies,
        'global:v1',
        600,
      );
      const ip = integrationApiDependencies.trustedIp?.(request);
      if (ip)
        await enforceIntegrationLimit(
          integrationApiDependencies,
          `ip:${await hostedSecretDigest(ip)}`,
          60,
        );
      if (request.headers.get('origin') !== getTrustedAppOrigin(request.url))
        throw new IntegrationError(
          403,
          'INVALID_ORIGIN',
          'Use the hosted checkout page to complete this booking.',
        );
      if (request.method !== 'POST') {
        headers.Allow = 'POST';
        throw new IntegrationError(
          405,
          'METHOD_NOT_ALLOWED',
          'Use POST for this endpoint.',
        );
      }
      const sessionId = integrationId(id);
      await enforceIntegrationLimit(
        integrationApiDependencies,
        `checkout:${sessionId}`,
        30,
      );
      const raw = await readIntegrationJson(request, 262144);
      const body =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      if (!isHostedSecret(body.access))
        throw new IntegrationError(
          404,
          'NOT_FOUND',
          'Checkout link not found.',
        );
      const view = await getHostedCheckout(sessionId, body.access);
      if (action === 'selection') {
        const { parseCheckoutIntent } = await import('./checkout-sessions.ts');
        const selection = parseCheckoutIntent(
          {
            event_id: view.event.id,
            items: body.items,
            promo_code: body.promo_code,
            return_url: 'https://selection.invalid/',
          },
          { environment: view.session.environment },
        );
        if (!selection.items.length)
          throw new IntegrationError(
            400,
            'INVALID_REQUEST',
            'Select at least one ticket.',
          );
        await integrationRpc('update_hosted_selection', {
          p_session: sessionId,
          p_access: await hostedSecretDigest(body.access),
          p_items: selection.items,
          p_promo: selection.promo_code,
        });
        return Response.json({ saved: true }, { headers });
      }
      if (action === 'cancel') {
        const result = await integrationRpc<{
          url: string | null;
          session_id: string;
          status: string;
        }>('cancel_hosted_checkout', {
          p_session_id: sessionId,
          p_access_hash: await hostedSecretDigest(body.access),
        });
        return Response.json(
          { statusUrl: buildIntegrationReturn(result) ?? '/events' },
          { headers },
        );
      }
      const token = await hostedSessionSecret(
        view.session,
        'reservation',
        checkoutSigningKeys(),
      );
      if (action === 'pay') {
        if (!view.reservation)
          throw new IntegrationError(
            409,
            'CHECKOUT_CONFLICT',
            'Reserve your selected tickets before payment.',
          );
        if (view.reservation.totalKobo > 0)
          requireHostedPaymentMode(view.session.environment, process.env);
        const result = await startCheckoutPayment(
          {
            orderId: view.reservation.orderId,
            checkoutToken: token,
            requestUrl: request.url,
          },
          {
            client: getSupabaseAdminClient(),
            initialize: initializePaystackTransaction,
            origin: getTrustedAppOrigin,
            deliver: scheduleDelivery,
            completedUrl: (orderId) =>
              integrationCompletedUrl(orderId, request.url),
            log: (metadata) =>
              console.info('payment_start', JSON.stringify(metadata)),
          },
        );
        return Response.json(result.body, { status: result.status, headers });
      }
      const input = parseReservationInput(body);
      if (input.eventId !== view.session.event_id)
        throw new IntegrationError(
          409,
          'CHECKOUT_CONFLICT',
          'The event cannot be changed.',
        );
      await validateStoredReservationTypes(input);
      const user = await getAuthenticatedUser(request);
      const args = reservationRpcInput(
        input,
        user?.id ?? null,
        await sha256Hex(token),
      );
      const reserved = await integrationRpc<
        Omit<CheckoutReservation, 'checkoutToken'>
      >('reserve_hosted_checkout', {
        p_session_id: sessionId,
        p_access_hash: await hostedSecretDigest(body.access),
        p_customer_id: args.p_customer_id,
        p_items: args.p_items,
        p_purchaser: args.p_purchaser,
        p_promo_code: args.p_promo_code,
        p_reservation_payload_hash: await reservationPayloadHash(
          input,
          user?.id ?? null,
        ),
      });
      return Response.json(
        { reservation: { ...reserved, checkoutToken: token } },
        { headers },
      );
    } catch (cause) {
      const failure =
        cause instanceof IntegrationError ? cause : reservationFailure(cause);
      const code =
        cause instanceof IntegrationError ? cause.code : 'CHECKOUT_CONFLICT';
      console.info(
        'hosted_checkout',
        JSON.stringify({
          request_id: requestId,
          route: action,
          status: failure.status,
          error_code: code,
        }),
      );
      return Response.json(
        { error: failure.message, code },
        { status: failure.status, headers },
      );
    }
  };
}
