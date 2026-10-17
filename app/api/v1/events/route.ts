import { integrationEventHandler } from '@/lib/integrations/events';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { integrationEventDependencies } from '@/lib/integrations/events.server';
const handle = integrationEventHandler(
  integrationApiDependencies,
  integrationEventDependencies,
  'list',
);
export const GET = handle;
export const OPTIONS = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
