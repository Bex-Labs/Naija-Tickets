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
import { requireHostedPaymentMode } from '@/lib/integrations/resource-mode';
import { verifyIntegrationResourceBinding } from '@/lib/integrations/resource-mode.server';
import { projectHostedReport } from '@/lib/integrations/hosted-report';
import { hostedLinkReadiness } from '@/lib/integrations/hosted-link-readiness';
import {
  usesIntegratedTesting,
  testServiceConfiguration,
} from '@/lib/integrations/testing';
import {
  ensureIntegratedTestLink,
  invalidateIntegrationTestCopy,
  verifyTestService,
  testServiceRpc,
} from '@/lib/integrations/testing.server';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return organiserIntegrationHandler(async (req, user) => {
    const mode = integrationEnvironment(
      new URL(req.url).searchParams.get('environment') || 'live',
    );
    const data = await integrationRpc<{ links: unknown[]; report: unknown }>(
      'organiser_hosted_overview',
      { p_user: user, p_app: integrationId((await context.params).id) },
    );
    const readiness = hostedLinkReadiness(process.env);
    let available =
      readiness.hostedLinksAvailable && readiness.environment === mode;
    let reason = '';
    let report = projectHostedReport(data.report);
    let paymentsReady = readiness.paymentsReady;
    let paymentMode = readiness.paymentMode;
    if (usesIntegratedTesting(mode, process.env)) {
      try {
        await verifyTestService();
        const testReport = await testServiceRpc<{ report: unknown } | null>(
          'integration_test_overview',
          {
            p_source: testServiceConfiguration(process.env).sourceProject,
            p_app: integrationId((await context.params).id),
          },
        );
        report = testReport ? projectHostedReport(testReport.report) : null;
        const flagsReady = readiness.hostedLinksAvailable;
        available = flagsReady;
        try {
          requireHostedPaymentMode('test', process.env);
          paymentsReady = true;
        } catch {
          paymentsReady = false;
        }
        if (!flagsReady)
          reason =
            'Enable hosted checkout and checkout links in the server settings.';
        paymentMode = 'test';
      } catch (cause) {
        available = false;
        report = null;
        reason =
          cause instanceof IntegrationError
            ? cause.message
            : 'Test checkout is temporarily unavailable.';
      }
    } else if (mode === 'live' && paymentMode !== 'live') {
      available = false;
      reason =
        'Real payments are not enabled on this server. Choose Test a purchase, or ask the platform administrator to activate Paystack Live payments.';
    }
    if (!available && !reason)
      reason =
        'Checkout is not configured for this purchase mode. Ask the platform administrator to activate it.';
    return {
      ...data,
      report,
      origin: getTrustedAppOrigin(req.url),
      environment: mode,
      hostedLinksAvailable: available,
      paymentsReady,
      paymentMode,
      unavailableReason: reason,
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
    const appId = integrationId((await context.params).id),
      eventId = integrationId(input.event_id);
    if (input.enabled && !hostedLinkReadiness(process.env).hostedLinksAvailable)
      throw new IntegrationError(
        503,
        'CHECKOUT_NOT_CONFIGURED',
        'Hosted checkout links are not enabled on this server.',
      );
    if (usesIntegratedTesting(mode, process.env)) {
      if (input.enabled)
        await ensureIntegratedTestLink(
          user,
          appId,
          { eventId, returnUrl, cancelUrl, enabled: true },
          true,
        );
      else await invalidateIntegrationTestCopy(user, appId);
    } else {
      await verifyIntegrationResourceBinding(mode);
      const ready = hostedLinkReadiness(process.env);
      if (input.enabled && mode === 'live' && ready.paymentMode !== 'live')
        throw new IntegrationError(
          503,
          'LIVE_PAYMENTS_UNAVAILABLE',
          'Real payments are not enabled. Choose Test a purchase to practise.',
        );
    }
    return integrationRpc('manage_hosted_checkout_link', {
      p_user: user,
      p_app: appId,
      p_event: eventId,
      p_mode: mode,
      p_return: returnUrl,
      p_cancel: cancelUrl,
      p_enabled: input.enabled,
    });
  })(request);
}
