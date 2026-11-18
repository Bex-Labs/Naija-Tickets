import { generateIntegrationCredential } from './keys.ts';
import { integrationRpc } from './store.server.ts';
import {
  validateWebsiteSetup,
  usesIntegratedTesting,
  testServiceConfiguration,
} from './testing.ts';
import {
  invalidateIntegrationTestCopy,
  verifyTestService,
} from './testing.server.ts';
import type {
  IntegrationApplication,
  IntegrationDashboard,
  IntegrationEnvironment,
} from './types.ts';
import {
  integrationId,
  parseIntegrationApplication,
  parseIntegrationKey,
  parseIntegrationStatus,
  readIntegrationJson,
} from './validation.ts';
export const listIntegrations = (userId: string) =>
  integrationRpc<IntegrationDashboard>('list_organiser_integrations', {
    p_user_id: userId,
  });
export async function saveIntegration(
  request: Request,
  userId: string,
  id: string | null = null,
) {
  const input = parseIntegrationApplication(await readIntegrationJson(request));
  if (input.setupMode)
    validateWebsiteSetup(
      input.websiteLocation,
      input.setupMode,
      input.domains
        .filter((d) => d.environment === input.setupMode)
        .map((d) => d.origin),
    );
  if (id) await invalidateIntegrationTestCopy(userId, integrationId(id));
  return integrationRpc<IntegrationApplication>(
    input.setupMode
      ? input.setupPath
        ? 'save_integration_setup_v2'
        : 'save_integration_setup'
      : 'save_organiser_integration',
    {
      p_user_id: userId,
      p_integration_id: id ? integrationId(id) : null,
      p_organiser_id: input.organiserId,
      p_name: input.name,
      p_status: input.status,
      p_domains: input.domains,
      p_event_ids: input.eventIds,
      ...(input.setupMode
        ? {
            p_setup_mode: input.setupMode,
            p_website_location: input.websiteLocation,
            ...(input.setupPath ? { p_setup_path: input.setupPath } : {}),
          }
        : {}),
    },
  );
}
export async function issueIntegrationKey(
  request: Request,
  userId: string,
  id: string,
  rotateId?: string,
) {
  const appId = integrationId(id);
  const previousId = rotateId ? integrationId(rotateId) : null;
  const input = previousId
    ? {
        environment: await integrationRpc<IntegrationEnvironment>(
          'get_organiser_integration_key_mode',
          { p_user_id: userId, p_integration_id: appId, p_key_id: previousId },
        ),
        scopes: ['integration:read'],
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      }
    : parseIntegrationKey(await readIntegrationJson(request));
  const generated = await generateIntegrationCredential(input.environment);
  if (usesIntegratedTesting(input.environment, process.env)) {
    testServiceConfiguration(process.env);
    await verifyTestService();
  }
  const application = await integrationRpc<IntegrationApplication>(
    'issue_organiser_integration_key',
    {
      p_user_id: userId,
      p_integration_id: appId,
      p_key_id: generated.id,
      p_digest: generated.digest,
      p_prefix: generated.prefix,
      p_suffix: generated.suffix,
      p_environment: input.environment,
      p_scopes: input.scopes,
      p_expires_at: input.expiresAt,
      p_rotate_key_id: previousId,
    },
  );
  // No raw secret is persisted, and failed writes never return one.
  return { application, secret: generated.credential, keyId: generated.id };
}
export async function revokeIntegrationKey(
  userId: string,
  id: string,
  keyId: string,
) {
  await invalidateIntegrationTestCopy(userId, integrationId(id));
  return integrationRpc<IntegrationApplication>(
    'revoke_organiser_integration_key',
    {
      p_user_id: userId,
      p_integration_id: integrationId(id),
      p_key_id: integrationId(keyId),
    },
  );
}

export async function setIntegrationStatus(
  request: Request,
  userId: string,
  id: string,
) {
  const status = parseIntegrationStatus(await readIntegrationJson(request));
  await invalidateIntegrationTestCopy(userId, integrationId(id));
  return integrationRpc<IntegrationApplication>(
    'change_organiser_integration_lifecycle',
    {
      p_user_id: userId,
      p_integration_id: integrationId(id),
      p_action: status === 'active' ? 'enable' : 'disable',
    },
  );
}
export async function removeIntegration(userId: string, id: string) {
  await invalidateIntegrationTestCopy(userId, integrationId(id));
  return integrationRpc<{ id: string; removed: true }>(
    'change_organiser_integration_lifecycle',
    {
      p_user_id: userId,
      p_integration_id: integrationId(id),
      p_action: 'remove',
    },
  );
}
