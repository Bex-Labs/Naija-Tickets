import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import {
  createWebhook,
  listWebhooks,
} from '@/lib/integrations/webhooks.server';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) =>
    listWebhooks(
      user,
      (await context.params).id,
      new URL(req.url).searchParams.get('before'),
    ),
  )(request);
}
export async function POST(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) =>
    createWebhook(req, user, (await context.params).id),
  )(request);
}
