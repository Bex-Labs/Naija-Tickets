import {
  integrationApiHandler,
  integrationIntrospection,
} from '@/lib/integrations/api';
import { requireAdvancedConfiguration } from '@/lib/integrations/operations';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { checkoutSigningKeys } from '@/lib/integrations/checkout-sessions.server';
import { verifyIntegrationResourceBinding } from '@/lib/integrations/resource-mode.server';
import { requireHostedCheckoutConfiguration } from '@/lib/integrations/resource-mode';
const handle = integrationApiHandler(
  integrationApiDependencies,
  'integration:read',
  'integration.introspect',
  async (context) => {
    const data = integrationIntrospection(context);
    let reads = false,
      checkout = false,
      advanced = false,
      entry = false;
    try {
      await verifyIntegrationResourceBinding(context.environment);
      reads = true;
    } catch {
      /* Metadata stays available when resources are unavailable. */
    }
    try {
      requireHostedCheckoutConfiguration(context.environment, process.env);
      checkoutSigningKeys();
      checkout = reads;
    } catch {
      /* No secret details in capability metadata. */
    }
    try {
      requireAdvancedConfiguration(context, false, process.env);
      advanced = reads;
    } catch {
      /* Disabled until configured. */
    }
    try {
      requireAdvancedConfiguration(context, true, process.env);
      entry = advanced;
    } catch {
      /* Additional entry opt-in. */
    }
    return {
      ...data,
      capabilities: {
        ...data.capabilities,
        event_api: reads,
        advanced_operations: advanced,
        delegated_entry: entry,
        hosted_checkout: checkout,
        sandbox_purchases: checkout && context.environment === 'test',
      },
    };
  },
);
export const GET = handle;
export const OPTIONS = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
