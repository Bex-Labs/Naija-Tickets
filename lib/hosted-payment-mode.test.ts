import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hostedPaymentMode,
  integrationResourceMode,
  requireHostedPaymentMode,
} from './integrations/resource-mode.ts';

test('payment mode is a server preference and does not rebind the event database', () => {
  const settings = {
    INTEGRATIONS_RESOURCE_MODE: 'live',
    INTEGRATIONS_CHECKOUT_ENABLED: 'true',
    HOSTED_CHECKOUT_PAYMENT_MODE: 'test',
    PAYSTACK_SECRET_KEY: 'sk_test_fixture',
  };
  assert.equal(integrationResourceMode(settings), 'live');
  assert.equal(requireHostedPaymentMode('live', settings), 'test');
  assert.equal(hostedPaymentMode('live', {}), 'live');
  assert.equal(hostedPaymentMode('test', {}), 'test');
});

test('Test resources never use Live payments, and invalid or mismatched settings fail closed', () => {
  assert.throws(() =>
    hostedPaymentMode('test', { HOSTED_CHECKOUT_PAYMENT_MODE: 'live' }),
  );
  for (const value of ['invalid', '', 'TEST'])
    assert.throws(() =>
      hostedPaymentMode('live', { HOSTED_CHECKOUT_PAYMENT_MODE: value }),
    );
  for (const key of ['', 'sk_live_fixture', 'pk_test_fixture']) {
    assert.throws(() =>
      requireHostedPaymentMode('live', {
        INTEGRATIONS_CHECKOUT_ENABLED: 'true',
        HOSTED_CHECKOUT_PAYMENT_MODE: 'test',
        PAYSTACK_SECRET_KEY: key,
      }),
    );
  }
});
