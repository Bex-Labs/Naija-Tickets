import { IntegrationError } from './integrations/errors.ts';
export type PaymentEnvironment = 'test' | 'live';
type Settings = Record<string, string | undefined>;

// Mode comes from the stored order, never from a checkout form or return URL.
export function paystackSecretForMode(
  mode: PaymentEnvironment,
  settings: Settings,
) {
  const secret =
    mode === 'test'
      ? settings.PAYSTACK_TEST_SECRET_KEY ||
        (settings.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')
          ? settings.PAYSTACK_SECRET_KEY
          : '')
      : settings.PAYSTACK_SECRET_KEY;
  if (!secret?.startsWith(mode === 'test' ? 'sk_test_' : 'sk_live_'))
    throw new IntegrationError(
      503,
      'PAYMENT_MODE_MISMATCH',
      mode === 'test'
        ? 'Test payments need a Paystack Test secret configured privately on the server.'
        : 'Real purchases need a Paystack Live secret configured privately on the server.',
    );
  return secret;
}
export function orderPaymentEnvironment(
  isTest: boolean,
  settings: Settings,
): PaymentEnvironment {
  const mode = isTest
    ? 'test'
    : settings.PAYSTACK_SECRET_KEY?.startsWith('sk_live_')
      ? 'live'
      : 'test';
  paystackSecretForMode(mode, settings);
  return mode;
}
export function paystackWebhookModes(settings: Settings): PaymentEnvironment[] {
  return (['test', 'live'] as const).filter((mode) => {
    try {
      paystackSecretForMode(mode, settings);
      return true;
    } catch {
      return false;
    }
  });
}
