import {
  integrationResourceMode,
  requireHostedPaymentMode,
} from './resource-mode.ts';
import { validateSigningKeys } from './checkout-access.ts';

export function hostedLinkReadiness(
  settings: Record<string, string | undefined>,
) {
  let environment: 'live' | 'test' | null = null;
  let signingReady = false;
  try {
    environment = integrationResourceMode(settings);
  } catch {
    /* Fail closed. */
  }
  try {
    const previous = JSON.parse(
      settings.INTEGRATIONS_PREVIOUS_SIGNING_KEYS || '{}',
    );
    if (!previous || typeof previous !== 'object' || Array.isArray(previous))
      throw Error();
    const version = settings.INTEGRATIONS_SIGNING_KEY_VERSION || 'v1';
    const keys = validateSigningKeys({
      activeVersion: version,
      keys: {
        ...previous,
        [version]: settings.INTEGRATIONS_SIGNING_SECRET || '',
      },
    });
    signingReady = !Object.values(keys.keys).some((value) =>
      [
        'PAYSTACK_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'ADMIN_SESSION_SECRET',
        'CRON_SECRET',
      ].some((name) => value === settings[name]),
    );
  } catch {
    /* Never expose private settings. */
  }
  const hostedLinksAvailable = Boolean(
    environment &&
    signingReady &&
    settings.INTEGRATIONS_CHECKOUT_ENABLED === 'true' &&
    settings.INTEGRATIONS_HOSTED_LINKS_ENABLED === 'true',
  );
  let paymentMode: 'test' | 'live' | null = null;
  if (hostedLinksAvailable && environment) {
    try {
      paymentMode = requireHostedPaymentMode(environment, settings);
    } catch {
      /* Payment configuration remains unavailable. */
    }
  }
  return {
    environment,
    hostedLinksAvailable,
    paymentsReady: paymentMode !== null,
    paymentMode,
  };
}
