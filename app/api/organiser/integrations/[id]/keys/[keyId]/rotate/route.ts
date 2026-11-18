import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import { issueIntegrationKey } from '@/lib/integrations/management.server';
type Context = { params: Promise<{ id: string; keyId: string }> };
export async function POST(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, userId) => {
    const { id, keyId } = await context.params;
    return issueIntegrationKey(req, userId, id, keyId);
  })(request);
}
