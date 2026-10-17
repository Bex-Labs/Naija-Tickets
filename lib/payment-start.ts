import {
  IntegrationError,
  integrationDatabaseError,
} from './integrations/errors.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PaystackRequestError,
  sha256Hex,
  type initializePaystackTransaction,
} from './paystack.ts';
export type PaymentStartResponse = {
  status: number;
  body: { [key: string]: unknown };
};
function paymentResponse(
  body: PaymentStartResponse['body'],
  options?: { status: number },
): PaymentStartResponse {
  return { status: options?.status ?? 200, body };
}
export type PaymentStartDependencies = {
  client: SupabaseClient;
  initialize: typeof initializePaystackTransaction;
  origin(requestUrl: string): string;
  deliver(orderId: string): void;
  completedUrl?(orderId: string): Promise<string | null>;
  requirePaymentMode?(amountKobo: number): void;
  log?(metadata: { code: string }): void;
};
type PreparedPayment = {
  outcome: string;
  order_id: string | null;
  order_reference: string | null;
  payment_reference: string | null;
  amount_kobo: number | string | null;
  currency: string | null;
  expires_at: string | null;
  authorization_url: string | null;
  purchaser_email: string | null;
};

function paymentStartFailure(error: unknown) {
  if (error instanceof IntegrationError)
    return { status: error.status, code: error.code, error: error.message };
  const message = error instanceof Error ? error.message : '';
  const databaseCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (databaseCode.startsWith('NT')) {
    const failure = integrationDatabaseError(error);
    return {
      status: failure.status,
      code: failure.code,
      error: failure.message,
    };
  }
  if (message === 'Paystack is not configured.') {
    return {
      status: 503,
      code: 'PAYMENT_KEY_MISSING',
      error: 'Online payments are not configured yet. Please contact support.',
    };
  }
  if (message.startsWith('APP_URL ')) {
    return {
      status: 503,
      code: 'PAYMENT_RETURN_URL',
      error:
        'The payment return address is not configured. Please contact support.',
    };
  }
  if (
    ['PGRST202', 'PGRST204', '42883', '42703', '42P01'].includes(databaseCode)
  ) {
    return {
      status: 503,
      code: 'PAYMENT_DATABASE_SETUP',
      error: 'Payment setup is incomplete. Please contact support.',
    };
  }
  if (error instanceof PaystackRequestError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: 503,
        code: 'PAYMENT_PROVIDER_AUTH',
        error:
          'The payment provider is not connected correctly. Please contact support.',
      };
    }
    return {
      status: 502,
      code: 'PAYMENT_PROVIDER_REJECTED',
      error:
        'The payment provider could not start this payment. Please try again shortly.',
    };
  }
  return {
    status: 502,
    code: 'PAYMENT_START_FAILED',
    error: 'Payment could not be started. Please try again.',
  };
}

export async function startCheckoutPayment(
  input: { orderId: string; checkoutToken: string; requestUrl: string },
  dependencies: PaymentStartDependencies,
): Promise<PaymentStartResponse> {
  const admin = dependencies.client;
  const leaseId = crypto.randomUUID();
  try {
    const { data, error } = await admin
      .rpc('claim_checkout_payment_initialization', {
        p_order_id: input.orderId,
        p_lease_id: leaseId,
        p_checkout_token_hash: await sha256Hex(input.checkoutToken),
      })
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    const prepared = (Array.isArray(data) ? data[0] : data) as
      | PreparedPayment
      | undefined;
    if (!prepared) throw new Error('The payment could not be prepared.');

    if (prepared.outcome === 'not_found') {
      return paymentResponse({ error: 'Order not found.' }, { status: 404 });
    }
    if (prepared.outcome === 'expired') {
      return paymentResponse(
        { error: 'This ticket reservation has expired.' },
        { status: 409 },
      );
    }
    if (prepared.outcome === 'already_paid') {
      let delivery = 'not_ready';
      if (prepared.order_id) {
        dependencies.deliver(prepared.order_id);
        delivery = 'in_progress';
      }
      return paymentResponse({
        completed: true,
        statusUrl:
          (await dependencies.completedUrl?.(input.orderId)) ??
          `/payment/status?result=success&reference=${encodeURIComponent(prepared.order_reference || '')}&delivery=${encodeURIComponent(delivery)}`,
      });
    }
    if (prepared.outcome === 'free') {
      const { data: completedData, error: completedError } = await admin
        .rpc('complete_free_checkout', {
          p_order_id: input.orderId,
          p_checkout_token_hash: await sha256Hex(input.checkoutToken),
        })
        .abortSignal(AbortSignal.timeout(8000));
      if (completedError) throw completedError;
      const completed = Array.isArray(completedData)
        ? completedData[0]
        : completedData;
      if (
        !completed ||
        !['success', 'already_paid'].includes(completed.outcome)
      ) {
        return paymentResponse(
          { error: 'The free booking could not be completed.' },
          { status: 409 },
        );
      }
      dependencies.deliver(input.orderId);
      return paymentResponse({
        completed: true,
        statusUrl:
          (await dependencies.completedUrl?.(input.orderId)) ??
          `/payment/status?result=success&reference=${encodeURIComponent(completed.order_reference)}&delivery=in_progress`,
      });
    }
    if (prepared.outcome === 'initialization_busy')
      return paymentResponse(
        {
          error: 'Payment is already starting. Wait a moment and try again.',
          code: 'PAYMENT_IN_PROGRESS',
        },
        { status: 409 },
      );
    if (prepared.outcome !== 'ready') {
      return paymentResponse(
        { error: 'This order is not available for payment.' },
        { status: 409 },
      );
    }
    dependencies.requirePaymentMode?.(Number(prepared.amount_kobo));
    if (prepared.authorization_url) {
      return paymentResponse({
        authorizationUrl: prepared.authorization_url,
        reference: prepared.payment_reference,
      });
    }

    const amountKobo = Number(prepared.amount_kobo);
    if (
      !Number.isSafeInteger(amountKobo) ||
      amountKobo <= 0 ||
      prepared.currency !== 'NGN' ||
      !prepared.payment_reference ||
      !prepared.order_reference ||
      !prepared.purchaser_email
    ) {
      throw new Error('The stored order total is invalid.');
    }

    const { data: settlementOrder, error: settlementOrderError } = await admin
      .from('orders')
      .select('fee_kobo,events!inner(organiser_id)')
      .eq('id', input.orderId)
      .abortSignal(AbortSignal.timeout(8000))
      .single();
    if (settlementOrderError) throw settlementOrderError;
    const eventRelation = settlementOrder.events as
      | { organiser_id: string }
      | { organiser_id: string }[];
    const organiserId = Array.isArray(eventRelation)
      ? eventRelation[0]?.organiser_id
      : eventRelation?.organiser_id;
    if (!organiserId) throw new Error('The event organiser is unavailable.');
    const { data: payoutData, error: payoutError } = await admin
      .from('organiser_payout_accounts')
      .select('provider_subaccount_code,direct_settlement_enabled')
      .eq('organiser_id', organiserId)
      .eq('direct_settlement_enabled', true)
      .abortSignal(AbortSignal.timeout(8000))
      .maybeSingle();
    const payoutTablePending = ['PGRST205', '42P01'].includes(
      payoutError?.code || '',
    );
    if (payoutError && !payoutTablePending) throw payoutError;
    const payout = payoutTablePending ? null : payoutData;
    const feeKobo = Number(settlementOrder.fee_kobo);
    if (!Number.isSafeInteger(feeKobo) || feeKobo < 0) {
      throw new Error('The stored service fee is invalid.');
    }
    const callbackUrl = `${dependencies.origin(input.requestUrl)}/payment/callback`;
    const initialization = await dependencies.initialize({
      email: prepared.purchaser_email,
      amountKobo,
      currency: prepared.currency,
      reference: prepared.payment_reference,
      callbackUrl,
      orderReference: prepared.order_reference,
      subaccountCode: payout?.provider_subaccount_code,
      transactionChargeKobo: payout ? feeKobo : undefined,
    });
    const result = initialization.data;
    const checkoutUrl = new URL(result.authorization_url);
    if (
      result.reference !== prepared.payment_reference ||
      checkoutUrl.protocol !== 'https:' ||
      checkoutUrl.hostname !== 'checkout.paystack.com'
    ) {
      throw new Error('Paystack returned an invalid checkout session.');
    }

    const { data: saved, error: updateError } = await admin
      .rpc('finish_checkout_payment_initialization', {
        p_reference: prepared.payment_reference,
        p_lease_id: leaseId,
        p_authorization_url: checkoutUrl.toString(),
        p_access_code: result.access_code,
        p_response: initialization,
        p_subaccount_code: payout?.provider_subaccount_code ?? null,
        p_transaction_charge_kobo: payout ? feeKobo : null,
      })
      .abortSignal(AbortSignal.timeout(8000));
    if (updateError) throw updateError;
    if (!saved) throw new Error('The payment initialization lease ended.');

    return paymentResponse({
      authorizationUrl: checkoutUrl.toString(),
      reference: prepared.payment_reference,
    });
  } catch (error) {
    dependencies.log?.({
      code:
        error instanceof PaystackRequestError
          ? String(error.status)
          : 'PAYMENT_START_FAILED',
    });
    const failure = paymentStartFailure(error);
    return paymentResponse(
      { error: failure.error, code: failure.code },
      { status: failure.status },
    );
  }
}
