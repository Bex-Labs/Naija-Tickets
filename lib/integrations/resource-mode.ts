import { IntegrationError } from './errors.ts';
import type { IntegrationEnvironment } from './types.ts';
import { testServiceConfiguration, usesIntegratedTesting } from './testing.ts';

type Settings = Record<string, string | undefined>;
const sandboxUnavailable = (): never => {
  throw new IntegrationError(
    503,
    'SANDBOX_NOT_CONFIGURED',
    'An isolated test checkout deployment is not configured. Test keys cannot use live business data.',
  );
};
export function integrationResourceMode(
  settings: Settings,
): IntegrationEnvironment {
  const mode = settings.INTEGRATIONS_RESOURCE_MODE ?? 'live';
  if (mode === 'live') return mode;
  if (mode !== 'test') return sandboxUnavailable();
  const sandbox = settings.INTEGRATIONS_SANDBOX_PROJECT_REF;
  const live = settings.INTEGRATIONS_LIVE_PROJECT_REF;
  if (
    !sandbox ||
    !live ||
    sandbox === live ||
    !/^[a-z0-9]{20}$/.test(sandbox) ||
    !/^[a-z0-9]{20}$/.test(live)
  )
    return sandboxUnavailable();
  let url: URL;
  try {
    url = new URL(settings.NEXT_PUBLIC_SUPABASE_URL ?? '');
  } catch {
    return sandboxUnavailable();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== `${sandbox}.supabase.co` ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/'
  )
    return sandboxUnavailable();
  if (!settings.PAYSTACK_SECRET_KEY?.startsWith('sk_test_'))
    return sandboxUnavailable();
  return 'test';
}
export function requireIntegrationResourceMode(
  environment: IntegrationEnvironment,
  settings: Settings,
) {
  if (usesIntegratedTesting(environment, settings)) {
    testServiceConfiguration(settings);
    return;
  }
  if (integrationResourceMode(settings) !== environment)
    return sandboxUnavailable();
}
export function requireHostedCheckoutConfiguration(
  environment: IntegrationEnvironment,
  settings: Settings,
) {
  requireIntegrationResourceMode(environment, settings);
  if (settings.INTEGRATIONS_CHECKOUT_ENABLED !== 'true')
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Hosted checkout has not been enabled for this deployment.',
    );
}
export function requireHostedPaymentMode(
  environment: IntegrationEnvironment,
  settings: Settings,
) {
  requireHostedCheckoutConfiguration(environment, settings);
  const paymentMode = hostedPaymentMode(environment, settings);
  if (
    !(
      environment === 'test' &&
      settings.INTEGRATIONS_LOCAL_TESTING_ENABLED === 'true'
        ? settings.PAYSTACK_TEST_SECRET_KEY ||
          (settings.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')
            ? settings.PAYSTACK_SECRET_KEY
            : '')
        : settings.PAYSTACK_SECRET_KEY
    )?.startsWith(paymentMode === 'test' ? 'sk_test_' : 'sk_live_')
  )
    throw new IntegrationError(
      503,
      'PAYMENT_MODE_MISMATCH',
      'The payment key does not match the configured checkout payment mode.',
    );
  return paymentMode;
}

// Business-data binding and Paystack payment mode are separate settings.
// The owner may explicitly run Test payments on the main hosted website.
// Browser input cannot select this mode; isolated Test resources never charge Live.
export function hostedPaymentMode(
  environment: IntegrationEnvironment,
  settings: Settings,
): IntegrationEnvironment {
  if (
    usesIntegratedTesting(environment, settings) &&
    (settings.INTEGRATIONS_TEST_ENABLED === 'true' ||
      settings.INTEGRATIONS_LOCAL_TESTING_ENABLED === 'true')
  ) {
    testServiceConfiguration(settings);
    return 'test';
  }
  const mode = settings.HOSTED_CHECKOUT_PAYMENT_MODE ?? environment;
  if (
    (mode !== 'test' && mode !== 'live') ||
    (environment === 'test' && mode !== 'test')
  ) {
    throw new IntegrationError(
      503,
      'PAYMENT_MODE_MISMATCH',
      'Configure a valid server-side checkout payment mode.',
    );
  }
  return mode;
}
