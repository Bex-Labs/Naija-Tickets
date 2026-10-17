import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import {
  saveIntegration,
  listIntegrations,
} from '@/lib/integrations/management.server';
import { integrationId } from '@/lib/integrations/validation';
import { IntegrationError } from '@/lib/integrations/errors';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return organiserIntegrationHandler(async (_request, userId) => {
    const id = integrationId((await context.params).id);
    const dashboard = await listIntegrations(userId);
    const application = dashboard.integrations.find((app) => app.id === id);
    if (!application)
      throw new IntegrationError(404, 'NOT_FOUND', 'Integration not found.');
    return application;
  })(request);
}
export async function PATCH(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, userId) =>
    saveIntegration(req, userId, (await context.params).id),
  )(request);
}
