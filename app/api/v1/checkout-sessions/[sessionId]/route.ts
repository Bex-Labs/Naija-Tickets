import { checkoutSessionStatusHandler } from '@/lib/integrations/checkout-sessions';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { checkoutSessionDependencies } from '@/lib/integrations/checkout-sessions.server';
async function handle(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  return checkoutSessionStatusHandler(
    integrationApiDependencies,
    checkoutSessionDependencies,
    sessionId,
  )(request);
}
export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
