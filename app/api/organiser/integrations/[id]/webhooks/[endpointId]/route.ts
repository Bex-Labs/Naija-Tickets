import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import { updateWebhook } from '@/lib/integrations/webhooks.server';
import { integrationRpc } from '@/lib/integrations/store.server';
import { integrationId } from '@/lib/integrations/validation';
type Context = { params: Promise<{ id: string; endpointId: string }> };
export async function PATCH(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) => {
    const { id, endpointId } = await context.params;
    return updateWebhook(req, user, id, endpointId);
  })(request);
}
export async function DELETE(request: Request, context: Context) {
  return organiserIntegrationHandler(async (_req, user) => {
    const { id, endpointId } = await context.params;
    await integrationRpc('retire_integration_webhook', {
      p_user: user,
      p_app: integrationId(id),
      p_id: integrationId(endpointId),
    });
    return { retired: true };
  })(request);
}
