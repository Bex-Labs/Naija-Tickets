import { advancedReadHandler } from '@/lib/integrations/operations';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { integrationOperationsDependencies } from '@/lib/integrations/operations.server';
export const runtime = 'nodejs';
const handle = advancedReadHandler(
  integrationApiDependencies,
  integrationOperationsDependencies,
  'sales',
);
export const GET = handle;
export const OPTIONS = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
