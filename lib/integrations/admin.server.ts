import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { verifyConfiguredAdminCredentials } from '@/lib/admin-credentials';
import { integrationRpc, integrationApiDependencies } from './store.server.ts';
import { enforceIntegrationLimit } from './api.ts';
import { credentialDigest } from './keys.ts';
import type { IntegrationOversightDependencies } from './admin.ts';
export const integrationOversightDependencies: IntegrationOversightDependencies =
  {
    authenticate: getAuthenticatedAdmin,
    verifyPassword: async (username, password) =>
      Boolean(await verifyConfiguredAdminCredentials(username, password)),
    overview: (search, status, after) =>
      integrationRpc('admin_integration_overview', {
        p_search: search,
        p_status: status,
        p_after: after,
      }),
    activity: async (app, before) => ({
      ...(await integrationRpc<Record<string, unknown>>(
        'admin_integration_activity',
        { p_app: app, p_before: before },
      )),
      hosted: await integrationRpc('integration_hosted_report', { p_app: app }),
    }),
    decide: (app, admin, suspend, reason) =>
      integrationRpc('admin_suspend_integration', {
        p_app: app,
        p_admin: admin,
        p_suspend: suspend,
        p_reason: reason,
      }),
    limit: async (admin) =>
      enforceIntegrationLimit(
        integrationApiDependencies,
        'admin-login:account:' + (await credentialDigest('oversight:' + admin)),
        30,
      ),
  };
