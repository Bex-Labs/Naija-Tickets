import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paystackSecretForMode,
  orderPaymentEnvironment,
  paystackWebhookModes,
} from './payment-environment.ts';
import { requireHostedPaymentMode } from './integrations/resource-mode.ts';
const settings = {
  PAYSTACK_SECRET_KEY: 'sk_live_private_fixture',
  PAYSTACK_TEST_SECRET_KEY: 'sk_test_private_fixture',
};
void test('test orders always use Test credentials even when real sales are enabled', () => {
  assert.equal(orderPaymentEnvironment(true, settings), 'test');
  assert.equal(orderPaymentEnvironment(false, settings), 'live');
  assert.equal(
    paystackSecretForMode('test', settings),
    settings.PAYSTACK_TEST_SECRET_KEY,
  );
  assert.equal(
    paystackSecretForMode('live', settings),
    settings.PAYSTACK_SECRET_KEY,
  );
  assert.deepEqual(paystackWebhookModes(settings), ['test', 'live']);
  assert.throws(() =>
    orderPaymentEnvironment(true, {
      PAYSTACK_SECRET_KEY: settings.PAYSTACK_SECRET_KEY,
    }),
  );
  assert.throws(() =>
    paystackSecretForMode('live', { PAYSTACK_SECRET_KEY: 'sk_test_fixture' }),
  );
  assert.throws(() =>
    paystackSecretForMode('test', {
      ...settings,
      PAYSTACK_TEST_SECRET_KEY: 'sk_live_wrong',
    }),
  );
});
void test('single-app checkout supports Test and real payments independently', () => {
  const local = {
    ...settings,
    INTEGRATIONS_RESOURCE_MODE: 'live',
    INTEGRATIONS_LOCAL_TESTING_ENABLED: 'true',
    INTEGRATIONS_CHECKOUT_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'private-fixture',
    INTEGRATIONS_SIGNING_SECRET: 'dedicated-checkout-fixture-'.repeat(3),
    APP_URL: 'https://tickets.example',
  };
  assert.equal(requireHostedPaymentMode('test', local), 'test');
  assert.equal(requireHostedPaymentMode('live', local), 'live');
  assert.throws(() =>
    requireHostedPaymentMode('test', {
      ...local,
      PAYSTACK_TEST_SECRET_KEY: '',
    }),
  );
  assert.throws(() =>
    requireHostedPaymentMode('live', {
      ...local,
      PAYSTACK_SECRET_KEY: 'sk_test_fixture',
    }),
  );
});
