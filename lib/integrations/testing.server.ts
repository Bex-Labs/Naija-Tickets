import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { integrationRpc } from './store.server.ts';
import { IntegrationError, integrationDatabaseError } from './errors.ts';
import { testServiceConfiguration, usesIntegratedTesting } from './testing.ts';
import type { IntegrationAuthProof } from './api.ts';
import type { IntegrationContext } from './types.ts';
import {
  hostedSecretDigest,
  hostedSessionSecret,
  validateSigningKeys,
} from './checkout-access.ts';
import type { StoredCheckoutSession } from './checkout-sessions.ts';

type Copy = {
  integrationId: string;
  organiserId: string;
  ownerId: string;
  keyId: string | null;
  events: Record<string, string>;
  tickets: Record<string, string>;
};
type TestLink = {
  publicId: string;
  eventId: string;
  returnUrl: string;
  cancelUrl: string;
  enabled: boolean;
  revision: number;
};
export function integratedTestSigningKeys() {
  const config = testServiceConfiguration(process.env);
  let previous: Record<string, string> = {};
  if (config.local) {
    try {
      previous = JSON.parse(
        process.env.INTEGRATIONS_PREVIOUS_SIGNING_KEYS || '{}',
      );
    } catch {
      throw new IntegrationError(
        503,
        'CHECKOUT_NOT_CONFIGURED',
        'Invalid checkout signing configuration.',
      );
    }
  }
  if (
    !previous ||
    typeof previous !== 'object' ||
    Array.isArray(previous) ||
    Object.values(previous).some((secret) =>
      [
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        process.env.PAYSTACK_SECRET_KEY,
        process.env.PAYSTACK_TEST_SECRET_KEY,
        process.env.ADMIN_SESSION_SECRET,
      ]
        .filter(Boolean)
        .includes(secret),
    )
  )
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Use dedicated checkout signing keys.',
    );
  return validateSigningKeys({
    activeVersion: config.signingVersion,
    keys: { ...previous, [config.signingVersion]: config.signingSecret },
  });
}
export async function testServiceRpc<T>(
  name: string,
  parameters: Record<string, unknown>,
  mapError = integrationDatabaseError,
): Promise<T> {
  const config = testServiceConfiguration(process.env);
  try {
    if (config.local) {
      const localNames: Record<string, string> = {
        sync_integration_test_copy: 'sync_local_integration_test_copy',
        invalidate_integration_test_copy:
          'invalidate_local_integration_test_copy',
        integration_test_overview: 'local_integration_test_overview',
      };
      return integrationRpc<T>(localNames[name] || name, parameters, mapError);
    }
    const client = createClient(config.databaseUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client
      .rpc(name, parameters)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapError(error);
    return data as T;
  } catch (cause) {
    if (cause instanceof IntegrationError) throw cause;
    throw new IntegrationError(
      503,
      'TESTING_UNAVAILABLE',
      'Test checkout is temporarily unavailable. Your live events and inventory are unaffected.',
    );
  }
}
export async function verifyTestService() {
  const config = testServiceConfiguration(process.env);
  const binding = await testServiceRpc<{
    environment: string;
    project_ref: string;
    live_project_ref: string;
    local_testing_enabled?: boolean;
  }>('get_integration_resource_settings', {});
  if (config.local) {
    if (
      binding?.environment !== 'live' ||
      !binding.local_testing_enabled ||
      (binding.project_ref && binding.project_ref !== config.project)
    )
      throw new IntegrationError(
        503,
        'TESTING_UNAVAILABLE',
        'Single-project testing needs its database migration. Ask the platform administrator to finish setup.',
      );
    return;
  }
  if (
    binding?.environment !== 'test' ||
    binding.project_ref !== config.project ||
    binding.live_project_ref !== config.sourceProject
  )
    throw new IntegrationError(
      503,
      'TESTING_UNAVAILABLE',
      'The isolated test service does not match this platform. Ask the platform administrator to check its configuration.',
    );
}
export async function prepareIntegrationTestCopy(input: {
  integrationId?: string;
  userId?: string;
  proof?: IntegrationAuthProof;
}) {
  await verifyTestService();
  const config = testServiceConfiguration(process.env);
  let appId = input.integrationId;
  if (input.proof) {
    const identity = await integrationRpc<IntegrationContext | null>(
      'authenticate_integration_key',
      {
        p_key_id: input.proof.keyId,
        p_digest: input.proof.digest,
        p_environment: 'test',
      },
    );
    if (!identity)
      throw new IntegrationError(
        401,
        'INVALID_API_KEY',
        'Provide a valid, active Test API key.',
      );
    appId = identity.integrationId;
  }
  const snapshot = await integrationRpc<Record<string, unknown>>(
    'integration_testing_snapshot',
    {
      p_app: appId,
      p_user: input.userId ?? null,
      p_key: input.proof?.keyId ?? null,
      p_digest: input.proof?.digest ?? null,
    },
  );
  // The replica never stores the public Test key's digest. Its internal authority
  // cannot be used by clients to bypass main-platform revocation or membership.
  const internalDigest = input.proof
    ? createHmac('sha256', config.bridgeSecret)
        .update(
          JSON.stringify([
            'integration-test-authority-v2',
            config.sourceProject,
            input.proof.keyId,
            input.proof.digest,
          ]),
        )
        .digest('hex')
    : null;
  const copy = await testServiceRpc<Copy>('sync_integration_test_copy', {
    p_source: config.sourceProject,
    p_snapshot: snapshot,
    p_internal_digest: internalDigest,
  });
  return { copy, internalDigest };
}
export async function integrationResourceRpc<T>(
  proof: IntegrationAuthProof,
  name: string,
  parameters: Record<string, unknown>,
  mapError = integrationDatabaseError,
): Promise<T> {
  if (!usesIntegratedTesting(proof.environment, process.env))
    return integrationRpc<T>(name, parameters, mapError);
  const { copy, internalDigest } = await prepareIntegrationTestCopy({ proof });
  const mapped = { ...parameters };
  if ('p_key_id' in mapped) mapped.p_key_id = copy.keyId;
  if ('p_key' in mapped) mapped.p_key = copy.keyId;
  mapped.p_digest = internalDigest;
  for (const field of ['p_event_id', 'p_event'])
    if (typeof mapped[field] === 'string')
      mapped[field] = copy.events[mapped[field]] ?? mapped[field];
  if (Array.isArray(mapped.p_items))
    mapped.p_items = mapped.p_items.map((item) => ({
      ...item,
      ticket_type_id: copy.tickets[item.ticket_type_id] ?? item.ticket_type_id,
    }));
  if (
    name === 'upsert_integration_external_event' &&
    mapped.p_payload &&
    typeof mapped.p_payload === 'object'
  ) {
    const payload = mapped.p_payload as Record<string, unknown>;
    if (typeof payload.title !== 'string')
      throw new IntegrationError(
        400,
        'INVALID_REQUEST',
        'Enter a valid event title.',
      );
    mapped.p_payload = {
      ...payload,
      title:
        '[TEST] ' + payload.title.replace(/^\[TEST\]\s*/, '').slice(0, 153),
    };
  }
  return testServiceRpc<T>(name, mapped, mapError);
}
export async function ensureIntegratedTestLink(
  userId: string,
  appId: string,
  input: {
    eventId: string;
    returnUrl: string;
    cancelUrl: string;
    enabled: boolean;
  },
  force = false,
) {
  const { copy } = await prepareIntegrationTestCopy({
    userId,
    integrationId: appId,
  });
  const eventId = copy.events[input.eventId];
  if (!eventId)
    throw new IntegrationError(
      403,
      'EVENT_NOT_ALLOWED',
      'Select and save this event in your website connection first.',
    );
  const overview = await testServiceRpc<{ links: TestLink[] }>(
    'organiser_hosted_overview',
    { p_user: copy.ownerId, p_app: copy.integrationId },
  );
  let link = overview.links.find(
    (l) =>
      l.eventId === eventId &&
      l.returnUrl === input.returnUrl &&
      l.cancelUrl === input.cancelUrl &&
      l.enabled === input.enabled,
  );
  if (force || !link)
    link = await testServiceRpc<TestLink>('manage_hosted_checkout_link', {
      p_user: copy.ownerId,
      p_app: copy.integrationId,
      p_event: eventId,
      p_mode: 'test',
      p_return: input.returnUrl,
      p_cancel: input.cancelUrl,
      p_enabled: input.enabled,
    });
  return { copy, link };
}
export async function startIntegratedTestLink(
  link: {
    integrationId: string;
    eventId: string;
    returnUrl: string;
    cancelUrl: string;
    managedBy: string;
    revision: number;
  },
  nonce: string,
) {
  const result = await ensureIntegratedTestLink(
    link.managedBy,
    link.integrationId,
    { ...link, enabled: true },
  );
  const signing = integratedTestSigningKeys();
  const session = {
    id: crypto.randomUUID(),
    environment: 'test' as const,
    expires_at: new Date(Date.now() + 1800000).toISOString(),
    signing_key_version: signing.activeVersion,
  };
  const stored = await testServiceRpc<StoredCheckoutSession>(
    'create_scoped_integration_session',
    {
      p_key_id: null,
      p_digest: null,
      p_environment: 'test',
      p_session_id: session.id,
      p_event_id: result.copy.events[link.eventId],
      p_items: [],
      p_promo_code: null,
      p_return_url: link.returnUrl,
      p_cancel_url: link.cancelUrl,
      p_idempotency_digest: await hostedSecretDigest(
        JSON.stringify([
          'integrated-test-link',
          result.link.publicId,
          link.revision,
          nonce,
        ]),
      ),
      p_payload_hash: await hostedSecretDigest(
        JSON.stringify([result.link.publicId, link.revision]),
      ),
      p_capability_hash: await hostedSecretDigest(
        await hostedSessionSecret(session, 'access', signing),
      ),
      p_reservation_hash: await hostedSecretDigest(
        await hostedSessionSecret(session, 'reservation', signing),
      ),
      p_signing_version: signing.activeVersion,
      p_expires_at: session.expires_at,
      p_widget_id: result.link.publicId,
      p_parent_origin: new URL(link.returnUrl).origin,
      p_widget_revision: result.link.revision,
    },
  );
  const access = await hostedSessionSecret(stored, 'access', signing);
  if ((await hostedSecretDigest(access)) !== stored.capability_hash)
    throw new IntegrationError(
      503,
      'TESTING_UNAVAILABLE',
      'Test checkout signing settings do not match.',
    );
  const url = new URL(
    `/integrations/checkout/${stored.id}`,
    testServiceConfiguration(process.env).checkoutOrigin,
  );
  url.searchParams.set('access', access);
  return url.toString();
}
export async function invalidateIntegrationTestCopy(
  userId: string,
  appId: string,
) {
  if (
    !usesIntegratedTesting('test', process.env) ||
    (process.env.INTEGRATIONS_TEST_ENABLED !== 'true' &&
      process.env.INTEGRATIONS_LOCAL_TESTING_ENABLED !== 'true')
  )
    return;
  // Verify the main manager before touching any isolated test configuration.
  const snapshot = await integrationRpc<{
    application: {
      domains: { environment: string }[];
      keys: { environment: string }[];
    };
    validLinks: unknown[];
  }>('integration_testing_snapshot', {
    p_app: appId,
    p_user: userId,
    p_key: null,
    p_digest: null,
  });
  if (
    !snapshot.application.domains.some((d) => d.environment === 'test') &&
    !snapshot.application.keys.some((k) => k.environment === 'test') &&
    !snapshot.validLinks.length
  )
    return;
  await verifyTestService();
  await testServiceRpc('invalidate_integration_test_copy', {
    p_source: testServiceConfiguration(process.env).sourceProject,
    p_app: appId,
  });
}
