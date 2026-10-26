import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { startCheckoutPayment } from './payment-start.ts';
import { IntegrationError } from './integrations/errors.ts';
import { PaystackRequestError } from './paystack.ts';
import { isPaymentEmail } from './payment-email.ts';
const id = '10000000-0000-4000-8000-000000000001',
  token = 'a'.repeat(64);
function fixture(outcome = 'ready', authorization: string | null = null) {
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  let saved = true;
  let initialized = 0;
  let delivered = 0;
  let received: unknown;
  let lease: unknown = null;
  let storedStatus = 'initialized';
  let storedAuthorization: string | null = authorization;
  const prepared = {
    outcome,
    order_id: id,
    order_reference: 'b'.repeat(36),
    payment_reference: 'NT-TEST12345678',
    amount_kobo: 105000,
    currency: 'NGN',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    authorization_url: authorization,
    purchaser_email: 'test@example.com',
  };
  const client = {
    rpc: (name: string, parameters: Record<string, unknown>) => {
      calls.push({ name, parameters });
      if (
        name === 'claim_checkout_payment_initialization' &&
        outcome === 'ready' &&
        !authorization
      )
        lease = parameters.p_lease_id;
      if (name === 'finish_checkout_payment_initialization' && saved)
        lease = null;
      return {
        abortSignal: async () => ({
          data:
            name === 'claim_checkout_payment_initialization'
              ? prepared
              : name === 'complete_free_checkout'
                ? {
                    outcome: 'success',
                    order_reference: prepared.order_reference,
                  }
                : saved,
          error: null,
        }),
      };
    },
    from: (table: string) => {
      if (table === 'payments') {
        const filters: Record<string, unknown> = {};
        let statuses: string[] = [];
        const update = {
          update: () => update,
          eq: (key: string, value: unknown) => {
            filters[key] = value;
            return update;
          },
          in: (_key: string, value: string[]) => {
            statuses = value;
            return update;
          },
          is: (key: string, value: unknown) => {
            filters[key] = value;
            return update;
          },
          abortSignal: async () => {
            if (
              filters.order_id === id &&
              filters.provider === 'paystack' &&
              filters.provider_reference === prepared.payment_reference &&
              filters.initialize_lease_id === lease &&
              filters.authorization_url === storedAuthorization &&
              statuses.includes(storedStatus)
            )
              lease = null;
            return { error: null };
          },
        };
        return update;
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        abortSignal: () => builder,
        single: async () => ({
          data: { fee_kobo: 5000, events: { organiser_id: id } },
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === 'organiser_payout_accounts'
              ? {
                  provider_subaccount_code: 'ACCT_FIXTURE',
                  direct_settlement_enabled: true,
                }
              : null,
          error: null,
        }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  const deps = {
    client,
    initialize: async (input: unknown) => {
      initialized++;
      received = input;
      return {
        status: true,
        message: 'Created',
        data: {
          reference: prepared.payment_reference,
          authorization_url: 'https://checkout.paystack.com/fixture',
          access_code: 'fixture',
        },
      };
    },
    origin: () => 'https://tickets.example',
    deliver: () => {
      delivered++;
    },
  };
  return {
    deps,
    calls,
    prepared,
    getInitialized: () => initialized,
    getDelivered: () => delivered,
    getReceived: () => received,
    hasLease: () => lease !== null,
    replaceLease: () => {
      lease = crypto.randomUUID();
    },
    markVerified: () => {
      storedStatus = 'verified';
    },
    saveCheckoutUrl: () => {
      storedAuthorization = 'https://checkout.paystack.com/already-saved';
    },
    setSaved: (value: boolean) => {
      saved = value;
    },
  };
}
void test('payment service uses authoritative amount, callback and original settlement fee routing; response persists under its lease', async () => {
  const f = fixture();
  const result = await startCheckoutPayment(
    {
      orderId: id,
      checkoutToken: token,
      requestUrl: 'https://attacker.example',
    },
    f.deps,
  );
  assert.equal(result.status, 200);
  assert.equal(f.getInitialized(), 1);
  assert.deepEqual(f.getReceived(), {
    email: 'test@example.com',
    amountKobo: 105000,
    currency: 'NGN',
    reference: 'NT-TEST12345678',
    callbackUrl: 'https://tickets.example/payment/callback',
    orderReference: 'b'.repeat(36),
    subaccountCode: 'ACCT_FIXTURE',
    transactionChargeKobo: 5000,
  });
  const start = f.calls.find(
      (call) => call.name === 'claim_checkout_payment_initialization',
    )!,
    finish = f.calls.find(
      (call) => call.name === 'finish_checkout_payment_initialization',
    )!;
  assert.equal(start.parameters.p_lease_id, finish.parameters.p_lease_id);
  assert.notEqual(start.parameters.p_checkout_token_hash, token);
  assert.equal(finish.parameters.p_transaction_charge_kobo, 5000);
});
void test('free/already-paid bookings deliver existing tickets and can use a validated partner result without provider initialization', async () => {
  for (const outcome of ['free', 'already_paid']) {
    const f = fixture(outcome);
    const result = await startCheckoutPayment(
      {
        orderId: id,
        checkoutToken: token,
        requestUrl: 'https://tickets.example',
      },
      {
        ...f.deps,
        completedUrl: async () =>
          'https://partner.example/done?nt_session=' + id + '&nt_status=paid',
      },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.completed, true);
    assert.equal(f.getInitialized(), 0);
    assert.equal(f.getDelivered(), 1);
    assert.ok(
      String(result.body.statusUrl).startsWith('https://partner.example/'),
    );
    assert.ok(!String(result.body.statusUrl).includes('b'.repeat(36)));
  }
});
void test('busy/expired/unknown orders and mode mismatch cannot start a charge; cached links respect mode too', async () => {
  for (const [outcome, status] of [
    ['initialization_busy', 409],
    ['expired', 409],
    ['not_found', 404],
  ] as const) {
    const f = fixture(outcome);
    assert.equal(
      (
        await startCheckoutPayment(
          {
            orderId: id,
            checkoutToken: token,
            requestUrl: 'https://tickets.example',
          },
          f.deps,
        )
      ).status,
      status,
    );
    assert.equal(f.getInitialized(), 0);
  }
  const f = fixture('ready', 'https://checkout.paystack.com/existing');
  const response = await startCheckoutPayment(
    {
      orderId: id,
      checkoutToken: token,
      requestUrl: 'https://tickets.example',
    },
    {
      ...f.deps,
      requirePaymentMode: () => {
        throw new IntegrationError(503, 'PAYMENT_MODE_MISMATCH', 'Wrong mode.');
      },
    },
  );
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PAYMENT_MODE_MISMATCH');
  assert.equal(f.getInitialized(), 0);
});
void test('uncertain initialization failures retain the attempt rather than mark it failed or create a second reference', async () => {
  const f = fixture();
  const result = await startCheckoutPayment(
    {
      orderId: id,
      checkoutToken: token,
      requestUrl: 'https://tickets.example',
    },
    {
      ...f.deps,
      initialize: async () => {
        throw Error('Private provider failure');
      },
    },
  );
  assert.equal(result.status, 502);
  assert.equal(f.hasLease(), true);
  assert.ok(!JSON.stringify(result).includes('Private'));
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['claim_checkout_payment_initialization'],
  );
  const stale = fixture();
  stale.setSaved(false);
  assert.equal(
    (
      await startCheckoutPayment(
        {
          orderId: id,
          checkoutToken: token,
          requestUrl: 'https://tickets.example',
        },
        stale.deps,
      )
    ).status,
    502,
  );
  assert.equal(stale.hasLease(), true);
});

void test('paid checkout rejects reserved test email domains before requesting a provider session and can retry without a stale lease', async () => {
  for (const email of [
    'person@fixture.test',
    'person@fixture.invalid',
    'person@fixture.example',
    'person@fixture.localhost',
  ]) {
    const f = fixture();
    f.prepared.purchaser_email = email;
    const input = {
      orderId: id,
      checkoutToken: token,
      requestUrl: 'https://tickets.example',
    };
    const result = await startCheckoutPayment(input, f.deps);
    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'PAYMENT_EMAIL_INVALID');
    assert.equal(f.getInitialized(), 0);
    assert.equal(f.hasLease(), false);
    f.prepared.purchaser_email = 'person@example.com';
    assert.equal((await startCheckoutPayment(input, f.deps)).status, 200);
    assert.equal(f.getInitialized(), 1);
    assert.equal(f.hasLease(), false);
  }
  assert.equal(isPaymentEmail(' person+ticket@gmail.com '), true);
  assert.equal(isPaymentEmail('PERSON@EXAMPLE.TEST'), false);
  assert.equal(isPaymentEmail('not an email'), false);
});

void test('definite email rejection unlocks only the current unpaid attempt; uncertain provider errors keep their lease', async () => {
  for (const [message, code, released] of [
    ['"email" must be a valid email', 'PAYMENT_EMAIL_INVALID', true],
    ['Invalid Email Address Passed', 'PAYMENT_EMAIL_INVALID', true],
    ['Duplicate Transaction Reference', 'PAYMENT_PROVIDER_REJECTED', false],
    ['An unknown provider error', 'PAYMENT_PROVIDER_REJECTED', false],
  ] as const) {
    const f = fixture();
    const result = await startCheckoutPayment(
      {
        orderId: id,
        checkoutToken: token,
        requestUrl: 'https://tickets.example',
      },
      {
        ...f.deps,
        initialize: async () => {
          throw new PaystackRequestError(message, 400);
        },
      },
    );
    assert.equal(result.body.code, code);
    assert.equal(f.hasLease(), !released);
  }
});

void test('rejected initialization cannot clear a newer lease, a verified payment, or a checkout URL saved by another worker', async () => {
  for (const protect of ['newerLease', 'verified', 'savedUrl']) {
    const f = fixture();
    await startCheckoutPayment(
      {
        orderId: id,
        checkoutToken: token,
        requestUrl: 'https://tickets.example',
      },
      {
        ...f.deps,
        initialize: async () => {
          if (protect === 'newerLease') f.replaceLease();
          else if (protect === 'verified') f.markVerified();
          else f.saveCheckoutUrl();
          throw new PaystackRequestError('"email" must be a valid email', 400);
        },
      },
    );
    assert.equal(f.hasLease(), true);
  }
});
