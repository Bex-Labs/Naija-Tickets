import { adminIntegrationsHandler } from '@/lib/integrations/admin';
import { integrationOversightDependencies } from '@/lib/integrations/admin.server';
export const runtime = 'nodejs';
async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminIntegrationsHandler(
    integrationOversightDependencies,
    (await context.params).id,
  )(request);
}
export const GET = handle;
export const PATCH = handle;
