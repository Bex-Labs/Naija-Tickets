import { integrationApiHandler } from '@/lib/integrations/api';
import { IntegrationError } from '@/lib/integrations/errors';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
const handle = integrationApiHandler(
  integrationApiDependencies,
  'integration:read',
  'api.not_found',
  () => {
    throw new IntegrationError(
      404,
      'NOT_FOUND',
      'This API endpoint is not available.',
    );
  },
);
export const GET = handle;
export const OPTIONS = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
