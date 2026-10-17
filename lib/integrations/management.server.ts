import { generateIntegrationCredential } from './keys.ts';
import { integrationRpc } from './store.server.ts';
import type {
  IntegrationApplication,
  IntegrationDashboard,
  IntegrationEnvironment,
} from './types.ts';
import {
  integrationId,
  parseIntegrationApplication,
  parseIntegrationKey,
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
  return integrationRpc<IntegrationApplication>('save_organiser_integration', {
    p_user_id: userId,
    p_integration_id: id ? integrationId(id) : null,
    p_organiser_id: input.organiserId,
    p_name: input.name,
    p_status: input.status,
    p_domains: input.domains,
    p_event_ids: input.eventIds,
  });
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
export function revokeIntegrationKey(
  userId: string,
  id: string,
  keyId: string,
) {
  return integrationRpc<IntegrationApplication>(
    'revoke_organiser_integration_key',
    {
      p_user_id: userId,
      p_integration_id: integrationId(id),
      p_key_id: integrationId(keyId),
    },
  );
}
