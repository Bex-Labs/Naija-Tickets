import { externalEventUpsertHandler } from '@/lib/integrations/external-events';
import { externalEventDependencies } from '@/lib/integrations/external-events.server';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
export const runtime = 'nodejs';
export async function PUT(
  request: Request,
  context: { params: Promise<{ externalId: string }> },
) {
  return externalEventUpsertHandler(
    integrationApiDependencies,
    externalEventDependencies,
    (await context.params).externalId,
  )(request);
}
