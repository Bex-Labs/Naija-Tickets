import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import { setIntegrationStatus } from '@/lib/integrations/management.server';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, userId) =>
    setIntegrationStatus(req, userId, (await context.params).id),
  )(request);
}
