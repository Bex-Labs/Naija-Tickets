import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import { revokeIntegrationKey } from '@/lib/integrations/management.server';
type Context = { params: Promise<{ id: string; keyId: string }> };
export async function POST(request: Request, context: Context) {
  return organiserIntegrationHandler(async (_req, userId) => {
    const { id, keyId } = await context.params;
    return revokeIntegrationKey(userId, id, keyId);
  })(request);
}
