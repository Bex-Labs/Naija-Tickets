import { IntegrationError } from './errors.ts';
import { integrationId, readIntegrationJson } from './validation.ts';
import { integrationApiDependencies, integrationRpc } from './store.server.ts';
import { requireHostedCheckoutConfiguration } from './resource-mode.ts';
import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
import { checkoutSigningKeys } from './checkout-sessions.server.ts';
import { hostedSessionSecret, hostedSecretDigest } from './checkout-access.ts';
import { getTrustedAppOrigin } from '@/lib/paystack';
import { enforceIntegrationLimit } from './api.ts';
import type { StoredCheckoutSession } from './checkout-sessions.ts';
export const HOSTED_LINK_PATTERN = /^nt_link_[a-f0-9]{32}$/;
export type HostedLink = {
  id: string;
  publicId: string;
  integrationId: string;
  organiserId: string;
  eventId: string;
  environment: 'test' | 'live';
  returnUrl: string;
  cancelUrl: string;
  revision: number;
  event: { title: string };
};
export async function readHostedLink(id: string) {
  if (
    process.env.INTEGRATIONS_HOSTED_LINKS_ENABLED !== 'true' ||
    !HOSTED_LINK_PATTERN.test(id)
  )
    throw new IntegrationError(
      404,
      'NOT_FOUND',
      'This hosted checkout link is unavailable.',
    );
  await enforceIntegrationLimit(integrationApiDependencies, 'global:v1', 600);
  const link = await integrationRpc<HostedLink>('read_hosted_link', {
    p_public: id,
  });
  requireHostedCheckoutConfiguration(link.environment, process.env);
  await verifyIntegrationResourceBinding(link.environment);
  return link;
}
export async function hostedLinkBudget(request: Request, link?: HostedLink) {
  await enforceIntegrationLimit(integrationApiDependencies, 'global:v1', 600);
  const ip = integrationApiDependencies.trustedIp?.(request);
  if (ip)
    await enforceIntegrationLimit(
      integrationApiDependencies,
      `ip:${await hostedSecretDigest(ip)}`,
      60,
    );
  if (link) {
    await enforceIntegrationLimit(
      integrationApiDependencies,
      `widget:create:${link.integrationId}`,
      10,
    );
    await enforceIntegrationLimit(
      integrationApiDependencies,
      `widget:create:org:${link.organiserId}`,
      30,
    );
  }
}
export async function startHostedLink(request: Request, id: string) {
  await hostedLinkBudget(request);
  if (
    request.method !== 'POST' ||
    request.headers.get('origin') !== getTrustedAppOrigin(request.url) ||
    request.headers.has('authorization')
  )
    throw new IntegrationError(
      403,
      'INVALID_ORIGIN',
      'Open the hosted checkout link to continue.',
    );
  const body = (await readIntegrationJson(request, 4096)) as Record<
    string,
    unknown
  >;
  if (!body || Object.keys(body).some((key) => key !== 'intent_id'))
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Start again from the hosted checkout link.',
    );
  const nonce = integrationId(body.intent_id),
    link = await readHostedLink(id);
  await hostedLinkBudget(request, link);
  const signing = checkoutSigningKeys(),
    session = {
      id: crypto.randomUUID(),
      environment: link.environment,
      expires_at: new Date(Date.now() + 1800000).toISOString(),
      signing_key_version: signing.activeVersion,
    };
  const stored = await integrationRpc<StoredCheckoutSession>(
    'create_scoped_integration_session',
    {
      p_key_id: null,
      p_digest: null,
      p_environment: link.environment,
      p_session_id: session.id,
      p_event_id: link.eventId,
      p_items: [],
      p_promo_code: null,
      p_return_url: link.returnUrl,
      p_cancel_url: link.cancelUrl,
      p_idempotency_digest: await hostedSecretDigest(
        JSON.stringify(['hosted-link', link.id, link.revision, nonce]),
      ),
      p_payload_hash: await hostedSecretDigest(
        JSON.stringify([link.id, link.revision]),
      ),
      p_capability_hash: await hostedSecretDigest(
        await hostedSessionSecret(session, 'access', signing),
      ),
      p_reservation_hash: await hostedSecretDigest(
        await hostedSessionSecret(session, 'reservation', signing),
      ),
      p_signing_version: session.signing_key_version,
      p_expires_at: session.expires_at,
      p_widget_id: link.publicId,
      p_parent_origin: new URL(link.returnUrl).origin,
      p_widget_revision: link.revision,
    },
  );
  const access = await hostedSessionSecret(stored, 'access', signing);
  if ((await hostedSecretDigest(access)) !== stored.capability_hash)
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Checkout signing unavailable.',
    );
  const target = new URL(
    `/integrations/checkout/${stored.id}`,
    getTrustedAppOrigin(request.url),
  );
  target.searchParams.set('access', access);
  return target.toString();
}
