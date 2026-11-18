import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedLinkReadiness } from './integrations/hosted-link-readiness.ts';
import { requireHostedPaymentMode } from './integrations/resource-mode.ts';
const base = {
  INTEGRATIONS_RESOURCE_MODE: 'live',
  INTEGRATIONS_HOSTED_LINKS_ENABLED: 'true',
  INTEGRATIONS_CHECKOUT_ENABLED: 'true',
  INTEGRATIONS_SIGNING_SECRET: 'x'.repeat(43),
};
test('link configuration is independent of charging; Test key cannot charge a Live checkout', () => {
  const settings = { ...base, PAYSTACK_SECRET_KEY: 'sk_test_fixture' };
  assert.deepEqual(hostedLinkReadiness(settings), {
    environment: 'live',
    hostedLinksAvailable: true,
    paymentsReady: false,
    paymentMode: null,
  });
  assert.throws(() => requireHostedPaymentMode('live', settings));
  assert.equal(
    hostedLinkReadiness({ ...base, PAYSTACK_SECRET_KEY: 'sk_live_fixture' })
      .paymentsReady,
    true,
  );
});
test('main website can explicitly use Test payments without changing the business resource binding', () => {
  const settings = {
    ...base,
    PAYSTACK_SECRET_KEY: 'sk_test_fixture',
    HOSTED_CHECKOUT_PAYMENT_MODE: 'test',
  };
  assert.equal(requireHostedPaymentMode('live', settings), 'test');
  assert.deepEqual(hostedLinkReadiness(settings), {
    environment: 'live',
    hostedLinksAvailable: true,
    paymentsReady: true,
    paymentMode: 'test',
  });
  for (const value of ['live', 'invalid', '']) {
    assert.throws(() =>
      requireHostedPaymentMode('live', {
        ...settings,
        HOSTED_CHECKOUT_PAYMENT_MODE: value,
      }),
    );
  }
  assert.throws(() =>
    requireHostedPaymentMode('live', {
      ...settings,
      PAYSTACK_SECRET_KEY: 'sk_live_fixture',
    }),
  );
});
test('missing flags, invalid or reused signing secrets and invalid sandbox binding fail closed', () => {
  for (const extra of [
    { INTEGRATIONS_HOSTED_LINKS_ENABLED: 'false' },
    { INTEGRATIONS_SIGNING_SECRET: '' },
    { INTEGRATIONS_PREVIOUS_SIGNING_KEYS: '[]' },
    { ADMIN_SESSION_SECRET: 'x'.repeat(43) },
    { INTEGRATIONS_RESOURCE_MODE: 'test' },
  ])
    assert.equal(
      hostedLinkReadiness({ ...base, ...extra }).hostedLinksAvailable,
      false,
    );
  const publicStatus = JSON.stringify(
    hostedLinkReadiness({ ...base, PAYSTACK_SECRET_KEY: 'sk_live_fixture' }),
  );
  assert.ok(!publicStatus.includes('sk_live_'));
  assert.ok(!publicStatus.includes('x'.repeat(43)));
});
