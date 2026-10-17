import { entryOperationHandler } from '@/lib/integrations/operations';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { integrationOperationsDependencies } from '@/lib/integrations/operations.server';
export const runtime = 'nodejs';
async function handle(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  return entryOperationHandler(
    integrationApiDependencies,
    integrationOperationsDependencies,
    (await context.params).eventId,
  )(request);
}
export const POST = handle;
export const GET = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
