import {
  organiserIntegrationHandler,
  integrationRpc,
} from '@/lib/integrations/store.server';
import { integrationId } from '@/lib/integrations/validation';
type Context = { params: Promise<{ id: string; deliveryId: string }> };
export async function POST(request: Request, context: Context) {
  return organiserIntegrationHandler(async (_req, user) => {
    const { id, deliveryId } = await context.params;
    await integrationRpc('retry_integration_webhook', {
      p_user: user,
      p_app: integrationId(id),
      p_delivery: integrationId(deliveryId),
    });
    return { queued: true };
  })(request);
}
