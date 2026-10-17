import { createCheckoutSessionHandler } from '@/lib/integrations/checkout-sessions';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { checkoutSessionDependencies } from '@/lib/integrations/checkout-sessions.server';
const handle = createCheckoutSessionHandler(
  integrationApiDependencies,
  checkoutSessionDependencies,
);
export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
