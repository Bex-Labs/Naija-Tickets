import {
  organiserIntegrationHandler,
  integrationRpc,
} from '@/lib/integrations/store.server';
import {
  integrationId,
  integrationEnvironment,
  readIntegrationJson,
} from '@/lib/integrations/validation';
import { checkoutReturnUrl } from '@/lib/integrations/checkout-sessions';
import { IntegrationError } from '@/lib/integrations/errors';
import { getTrustedAppOrigin } from '@/lib/paystack';
import { verifyIntegrationResourceBinding } from '@/lib/integrations/resource-mode.server';
import { projectHostedReport } from '@/lib/integrations/hosted-report';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) => {
    const data = await integrationRpc<{ links: unknown[]; report: unknown }>(
      'organiser_hosted_overview',
      { p_user: user, p_app: integrationId((await context.params).id) },
    );
    return {
      ...data,
      report: projectHostedReport(data.report),
      origin: getTrustedAppOrigin(req.url),
      hostedLinksAvailable:
        process.env.INTEGRATIONS_HOSTED_LINKS_ENABLED === 'true' &&
        process.env.INTEGRATIONS_CHECKOUT_ENABLED === 'true',
    };
  })(request);
}
export async function POST(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) => {
    const input = (await readIntegrationJson(req)) as Record<string, unknown>;
    if (
      !input ||
      Object.keys(input).some(
        (k) =>
          ![
            'event_id',
            'environment',
            'return_url',
            'cancel_url',
            'enabled',
          ].includes(k),
      ) ||
      typeof input.enabled !== 'boolean'
    )
      throw new IntegrationError(
        400,
        'INVALID_REQUEST',
        'Choose an event, website return address and link status.',
      );
    const mode = integrationEnvironment(input.environment),
      returnUrl = checkoutReturnUrl(input.return_url, { environment: mode }),
      cancelUrl = checkoutReturnUrl(input.cancel_url ?? input.return_url, {
        environment: mode,
      });
    if (new URL(returnUrl).origin !== new URL(cancelUrl).origin)
      throw new IntegrationError(
        400,
        'INVALID_REQUEST',
        'Use the same registered website for the link’s return and cancellation.',
      );
    await verifyIntegrationResourceBinding(mode);
    return integrationRpc('manage_hosted_checkout_link', {
      p_user: user,
      p_app: integrationId((await context.params).id),
      p_event: integrationId(input.event_id),
      p_mode: mode,
      p_return: returnUrl,
      p_cancel: cancelUrl,
      p_enabled: input.enabled,
    });
  })(request);
}
