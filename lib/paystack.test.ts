import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  deactivatePaystackSubaccount,
  getTrustedAppOrigin,
  isValidPaystackReference,
  paystackSplitFields,
  verifyPaystackWebhookSignature,
} from './paystack.ts';

process.env.PAYSTACK_SECRET_KEY = 'sk_test_naija_tickets_unit_test_only';

void test('accepts only Paystack-compatible transaction references', () => {
  assert.equal(isValidPaystackReference('NT-ABC123456789'), true);
  assert.equal(isValidPaystackReference('../not-a-reference'), false);
  assert.equal(isValidPaystackReference('short'), false);
});

void test('rejects an invalid subaccount before deactivation', async () => {
  await assert.rejects(() => deactivatePaystackSubaccount('invalid-code'));
});

void test('builds an exact flat platform share for split settlement', () => {
  assert.deepEqual(paystackSplitFields('ACCT_abc123', 85000), {
    subaccount: 'ACCT_abc123',
    transaction_charge: 85000,
  });
  assert.deepEqual(paystackSplitFields(), {});
  assert.throws(() => paystackSplitFields('not-a-subaccount', 85000));
  assert.throws(() => paystackSplitFields('ACCT_abc123', -1));
});

void test('validates an HMAC SHA512 signature over the exact raw payload', async () => {
  const rawPayload = '{"event":"charge.success","data":{"id":42}}';
  const signature = createHmac('sha512', 'sk_test_naija_tickets_unit_test_only')
    .update(rawPayload)
    .digest('hex');

  assert.equal(
    await verifyPaystackWebhookSignature(rawPayload, signature),
    true,
  );
  assert.equal(
    await verifyPaystackWebhookSignature(`${rawPayload} `, signature),
    false,
  );
  assert.equal(await verifyPaystackWebhookSignature(rawPayload, 'bad'), false);
});

void test('uses only a configured HTTPS application origin in production', () => {
  process.env.APP_URL = 'https://tickets.example.com/some/path';
  assert.equal(
    getTrustedAppOrigin('https://untrusted.example.net/checkout'),
    'https://tickets.example.com',
  );

  process.env.APP_URL = 'http://tickets.example.com';
  assert.throws(() =>
    getTrustedAppOrigin('https://untrusted.example.net/checkout'),
  );
});
