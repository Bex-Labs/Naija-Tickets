import { NextResponse } from 'next/server';
import { waitUntil } from 'cloudflare:workers';
import {
  getTrustedAppOrigin,
  initializePaystackTransaction,
  sha256Hex,
} from '@/lib/paystack';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { deliverOrderTickets } from '@/lib/ticket-delivery';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const orderId =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).orderId
      : null;
  const checkoutToken =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).checkoutToken
      : null;
  if (
    typeof orderId !== 'string' ||
    !UUID_PATTERN.test(orderId) ||
    typeof checkoutToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(checkoutToken)
  ) {
    return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  try {
    const { data, error } = await admin.rpc('prepare_paystack_payment', {
      p_order_id: orderId,
      p_checkout_token_hash: await sha256Hex(checkoutToken),
    });
    if (error) throw error;
    const prepared = (Array.isArray(data) ? data[0] : data) as
      | PreparedPayment
      | undefined;
    if (!prepared) throw new Error('The payment could not be prepared.');

    if (prepared.outcome === 'not_found') {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    if (prepared.outcome === 'expired') {
      return NextResponse.json(
        { error: 'This ticket reservation has expired.' },
        { status: 409 },
      );
    }
    if (prepared.outcome === 'already_paid') {
      let delivery = 'not_ready';
      if (prepared.order_id) {
        waitUntil(deliverOrderTickets(prepared.order_id));
        delivery = 'in_progress';
      }
      return NextResponse.json({
        completed: true,
        statusUrl: `/payment/status?result=success&reference=${encodeURIComponent(prepared.order_reference || '')}&delivery=${encodeURIComponent(delivery)}`,
      });
    }
    if (prepared.outcome === 'free') {
      const { data: completedData, error: completedError } = await admin.rpc(
        'complete_free_checkout',
        {
          p_order_id: orderId,
          p_checkout_token_hash: await sha256Hex(checkoutToken),
        },
      );
      if (completedError) throw completedError;
      const completed = Array.isArray(completedData)
        ? completedData[0]
        : completedData;
      if (
        !completed ||
        !['success', 'already_paid'].includes(completed.outcome)
      ) {
        return NextResponse.json(
          { error: 'The free booking could not be completed.' },
          { status: 409 },
        );
      }
      waitUntil(deliverOrderTickets(orderId));
      return NextResponse.json({
        completed: true,
        statusUrl: `/payment/status?result=success&reference=${encodeURIComponent(completed.order_reference)}&delivery=in_progress`,
      });
    }
    if (prepared.outcome !== 'ready') {
      return NextResponse.json(
        { error: 'This order is not available for payment.' },
        { status: 409 },
      );
    }
    if (prepared.authorization_url) {
      return NextResponse.json({
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

    try {
      const { data: settlementOrder, error: settlementOrderError } =
        await admin
          .from('orders')
          .select('fee_kobo,events!inner(organiser_id)')
          .eq('id', orderId)
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
      const callbackUrl = `${getTrustedAppOrigin(request.url)}/payment/callback`;
      const initialization = await initializePaystackTransaction({
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

      const splitAudit = payout
        ? {
            provider_subaccount_code: payout.provider_subaccount_code,
            platform_transaction_charge_kobo: feeKobo,
          }
        : {};
      const { error: updateError } = await admin
        .from('payments')
        .update({
          status: 'pending',
          authorization_url: checkoutUrl.toString(),
          access_code: result.access_code,
          initialization_response: initialization,
          provider_status: 'initialized',
          ...splitAudit,
          updated_at: new Date().toISOString(),
        })
        .eq('provider', 'paystack')
        .eq('provider_reference', prepared.payment_reference);
      if (updateError) throw updateError;

      return NextResponse.json({
        authorizationUrl: checkoutUrl.toString(),
        reference: prepared.payment_reference,
      });
    } catch (initializationError) {
      const { error: cleanupError } = await admin
        .from('payments')
        .update({
          status: 'failed',
          provider_status: 'initialization_failed',
          updated_at: new Date().toISOString(),
        })
        .eq('provider', 'paystack')
        .eq('provider_reference', prepared.payment_reference)
        .eq('status', 'initialized');
      if (cleanupError) {
        console.error('Paystack attempt cleanup failed', cleanupError);
      }
      throw initializationError;
    }
  } catch (error) {
    console.error('Paystack initialization failed', error);
    return NextResponse.json(
      { error: 'Payment could not be started. Please try again.' },
      { status: 502 },
    );
  }
}
