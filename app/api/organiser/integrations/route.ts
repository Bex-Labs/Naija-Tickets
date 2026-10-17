import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import {
  listIntegrations,
  saveIntegration,
} from '@/lib/integrations/management.server';
export const GET = organiserIntegrationHandler((_request, userId) =>
  listIntegrations(userId),
);
export const POST = organiserIntegrationHandler((request, userId) =>
  saveIntegration(request, userId),
);
