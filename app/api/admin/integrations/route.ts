import { adminIntegrationsHandler } from '@/lib/integrations/admin';
import { integrationOversightDependencies } from '@/lib/integrations/admin.server';
export const runtime = 'nodejs';
export const GET = adminIntegrationsHandler(integrationOversightDependencies);
