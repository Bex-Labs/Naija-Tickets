import { integrationEventHandler } from '@/lib/integrations/events';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { integrationEventDependencies } from '@/lib/integrations/events.server';
async function handle(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  return integrationEventHandler(
    integrationApiDependencies,
    integrationEventDependencies,
    'tickets',
    eventId,
  )(request);
}
export const GET = handle;
export const OPTIONS = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
