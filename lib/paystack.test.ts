import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  deactivatePaystackSubaccount,
  getTrustedAppOrigin,
  isValidPaystackReference,
  initializePaystackTransaction,
  PaystackRequestError,
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

void test('local checkout returns to the active port, not a stale APP_URL', (t) => {
  const environment: Record<string, string | undefined> = process.env;
  const previousNodeEnv = environment.NODE_ENV;
  const previousAppUrl = process.env.APP_URL;
  t.after(() => {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  });
  environment.NODE_ENV = 'development';
  process.env.APP_URL = 'http://localhost:3000';
  assert.equal(
    getTrustedAppOrigin(
      'http://localhost:3002/api/payments/paystack/initialize',
    ),
    'http://localhost:3002',
  );
  assert.equal(
    getTrustedAppOrigin('http://127.0.0.1:3003/payment/callback'),
    'http://127.0.0.1:3003',
  );
  environment.NODE_ENV = 'production';
  assert.throws(
    () => getTrustedAppOrigin('https://tickets.example.com'),
    /public HTTPS/,
  );
  process.env.APP_URL = 'https://tickets.example.com';
  assert.equal(
    getTrustedAppOrigin('https://untrusted.example.com/payment/callback'),
    'https://tickets.example.com',
  );
});

void test('uses the Vercel production domain when APP_URL is absent', (t) => {
  const environment: Record<string, string | undefined> = process.env;
  const previous = {
    NODE_ENV: environment.NODE_ENV,
    APP_URL: environment.APP_URL,
    VERCEL_ENV: environment.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL:
      environment.VERCEL_PROJECT_PRODUCTION_URL,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  });
  environment.NODE_ENV = 'production';
  delete environment.APP_URL;
  environment.VERCEL_ENV = 'production';
  environment.VERCEL_PROJECT_PRODUCTION_URL = 'naija-tickets.vercel.app';
  assert.equal(
    getTrustedAppOrigin('https://untrusted.example.net/checkout'),
    'https://naija-tickets.vercel.app',
  );
});

void test('initialization supplies the app return URL and a cancellation return route', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
      assert.equal(body.callback_url, 'http://localhost:3002/payment/callback');
      const metadata = JSON.parse(body.metadata);
      assert.equal(
        metadata.cancel_action,
        'http://localhost:3002/payment/callback?reference=NT-ABC123456789',
      );
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: body.reference,
            authorization_url: 'https://checkout.paystack.com/example',
            access_code: 'fixture',
          },
        }),
      );
    },
  );
  await initializePaystackTransaction({
    email: 'buyer@example.com',
    amountKobo: 100000,
    currency: 'NGN',
    reference: 'NT-ABC123456789',
    callbackUrl: 'http://localhost:3002/payment/callback',
    orderReference: 'NT-ORDER123',
  });
});

void test('preserves a safe Paystack HTTP status for payment diagnostics', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ status: false, message: 'Invalid key' }), {
      status: 401,
    }),
  );
  await assert.rejects(
    () =>
      initializePaystackTransaction({
        email: 'buyer@example.com',
        amountKobo: 100000,
        currency: 'NGN',
        reference: 'NT-ABC123456789',
        callbackUrl: 'https://naija-tickets.vercel.app/payment/callback',
        orderReference: 'NT-ORDER123',
      }),
    (error: unknown) =>
      error instanceof PaystackRequestError && error.status === 401,
  );
});
