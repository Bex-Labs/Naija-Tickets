import { organiserIntegrationHandler } from '@/lib/integrations/store.server';
import { integrationResourceMode } from '@/lib/integrations/resource-mode';
import { testServiceConfiguration } from '@/lib/integrations/testing';
import {
  listIntegrations,
  saveIntegration,
} from '@/lib/integrations/management.server';
export const GET = organiserIntegrationHandler(async (_request, userId) => {
  const dashboard = await listIntegrations(userId);
  let workspaceMode: 'test' | 'live' | null = null;
  try {
    workspaceMode = integrationResourceMode(process.env);
  } catch {
    /* Show configuration failure without secrets. */
  }
  let integratedTesting = false;
  try {
    testServiceConfiguration(process.env);
    integratedTesting = true;
  } catch {
    /* No secrets in dashboard metadata. */
  }
  return { ...dashboard, viewerId: userId, workspaceMode, integratedTesting };
});
export const POST = organiserIntegrationHandler((request, userId) =>
  saveIntegration(request, userId),
);
