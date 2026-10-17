import { requireIntegrationResourceMode } from './resource-mode.ts';
import { integrationRpc } from './store.server.ts';
import { IntegrationError } from './errors.ts';

export async function verifyIntegrationResourceBinding(
  environment: 'test' | 'live',
) {
  requireIntegrationResourceMode(environment, process.env);
  const stored = await integrationRpc<{
    environment: string;
    project_ref: string | null;
    live_project_ref: string | null;
  }>('get_integration_resource_settings', {});
  if (
    !stored ||
    stored.environment !== environment ||
    (environment === 'test' &&
      (stored.project_ref !== process.env.INTEGRATIONS_SANDBOX_PROJECT_REF ||
        stored.live_project_ref !== process.env.INTEGRATIONS_LIVE_PROJECT_REF))
  )
    throw new IntegrationError(
      503,
      'SANDBOX_NOT_CONFIGURED',
      'The database resource binding does not match this deployment.',
    );
}
