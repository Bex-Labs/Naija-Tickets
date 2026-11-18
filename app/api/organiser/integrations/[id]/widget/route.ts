import {
  organiserIntegrationHandler,
  integrationRpc,
} from '@/lib/integrations/store.server';
import {
  integrationId,
  integrationEnvironment,
  readIntegrationJson,
} from '@/lib/integrations/validation';
import { IntegrationError } from '@/lib/integrations/errors';
import { verifyIntegrationResourceBinding } from '@/lib/integrations/resource-mode.server';
import { getTrustedAppOrigin } from '@/lib/paystack';
import type { WidgetConfiguration } from '@/lib/integrations/widget-types';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) => ({
    ...(await integrationRpc<WidgetConfiguration>('manage_integration_widget', {
      p_user: user,
      p_app: integrationId((await context.params).id),
      p_mode: integrationEnvironment(
        new URL(req.url).searchParams.get('environment'),
      ),
      p_enabled: null,
      p_checkout: null,
    })),
    widgetOrigin: getTrustedAppOrigin(req.url),
  }))(request);
}
export async function PATCH(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) => {
    const input = (await readIntegrationJson(req)) as Record<string, unknown>;
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      typeof input.checkoutEnabled !== 'boolean'
    )
      throw new IntegrationError(
        400,
        'INVALID_WIDGET',
        'Choose widget visibility and checkout permissions.',
      );
    const mode = integrationEnvironment(input.environment);
    await verifyIntegrationResourceBinding(mode);
    return {
      ...(await integrationRpc<WidgetConfiguration>(
        'manage_integration_widget',
        {
          p_user: user,
          p_app: integrationId((await context.params).id),
          p_mode: mode,
          p_enabled: input.enabled,
          p_checkout: input.checkoutEnabled,
        },
      )),
      widgetOrigin: getTrustedAppOrigin(req.url),
    };
  })(request);
}
