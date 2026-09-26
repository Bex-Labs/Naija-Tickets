import { NextResponse } from 'next/server';
import { waitUntil } from 'cloudflare:workers';
import { parsePaystackRefund } from '@/lib/admin-refunds';
import { finalizePaystackPayment } from '@/lib/payments';
import {
  getPaystackRefund,
  isValidPaystackReference,
  sha256Hex,
  verifyPaystackWebhookSignature,
} from '@/lib/paystack';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { deliverOrderTickets } from '@/lib/ticket-delivery';

type PaystackWebhook = {
  event?: unknown;
  data?: unknown;
};

const refundEvents = new Set([
  'refund.pending',
  'refund.processing',
  'refund.needs-attention',
  'refund.failed',
  'refund.processed',
]);

async function reconcileRecordedRefund(data: unknown) {
  if (!data || typeof data !== 'object') return 'invalid';
  const values = data as Record<string, unknown>;
  const transactionReference = values.transaction_reference;
  const amount = Number(values.amount);
  if (
    typeof transactionReference !== 'string' ||
    !isValidPaystackReference(transactionReference) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    values.currency !== 'NGN'
  ) {
    return 'invalid';
  }

  const client = getSupabaseAdminClient();
  const { data: payment, error: paymentError } = await client
    .from('payments')
    .select('order_id,provider_transaction_id')
    .eq('provider', 'paystack')
    .eq('provider_reference', transactionReference)
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment) return 'unmatched';

  const { data: refunds, error: refundError } = await client
    .from('refunds')
    .select('provider_refund_id,admin_actor_id')
    .eq('order_id', payment.order_id)
    .eq('amount_kobo', amount)
    .eq('status', 'processing');
  if (refundError) throw refundError;
  if (!refunds || refunds.length !== 1 || !refunds[0].provider_refund_id) {
    return 'unmatched';
  }

  const refundId = refunds[0].provider_refund_id as string;
  const provider = parsePaystackRefund(
    (await getPaystackRefund(refundId)).data,
    refundId,
  );
  const { error: updateError } = await client.rpc('record_admin_refund', {
    p_order_id: payment.order_id,
    p_provider_refund_id: provider.id,
    p_provider_transaction_id: provider.transactionId,
    p_amount_kobo: provider.amountKobo,
    p_currency: provider.currency,
    p_provider_status: provider.providerStatus,
    p_reason: '',
    p_admin_actor_id: refunds[0].admin_actor_id || 'paystack-webhook',
  });
  if (updateError) throw updateError;
  return 'updated';
}

export async function POST(request: Request) {
  const rawBytes = await request.arrayBuffer();
  const rawPayload = new TextDecoder().decode(rawBytes);
  const suppliedSignature = request.headers.get('x-paystack-signature') || '';

  try {
    if (!(await verifyPaystackWebhookSignature(rawBytes, suppliedSignature))) {
      return NextResponse.json(
        { error: 'Invalid signature.' },
        { status: 401 },
      );
    }
  } catch (error) {
    console.error('Paystack webhook signature check failed', error);
    return NextResponse.json(
      { error: 'Webhook verification is unavailable.' },
      { status: 503 },
    );
  }

  let event: PaystackWebhook;
  try {
    event = JSON.parse(rawPayload) as PaystackWebhook;
  } catch {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }
  if (typeof event.event === 'string' && refundEvents.has(event.event)) {
    try {
      return NextResponse.json({
        received: true,
        outcome: await reconcileRecordedRefund(event.data),
      });
    } catch (error) {
      console.error('Paystack refund reconciliation failed', error);
      return NextResponse.json(
        { error: 'Refund reconciliation failed.' },
        { status: 500 },
      );
    }
  }
  if (event.event !== 'charge.success') {
    return NextResponse.json({ received: true, ignored: true });
  }
  if (!event.data || typeof event.data !== 'object') {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }

  const transaction = event.data as Record<string, unknown>;
  const reference = transaction.reference;
  const status = transaction.status;
  const amount = Number(transaction.amount);
  const currency = transaction.currency;
  const transactionId = transaction.id;
  if (
    typeof reference !== 'string' ||
    !isValidPaystackReference(reference) ||
    status !== 'success' ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    typeof currency !== 'string' ||
    !['string', 'number'].includes(typeof transactionId)
  ) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }

  try {
    const providerEventId = `charge.success:${String(transactionId)}:${reference}`;
    const outcome = await finalizePaystackPayment({
      reference,
      status,
      amountKobo: amount,
      currency,
      transactionId: String(transactionId),
      payload: event,
      eventId: providerEventId,
      eventType: 'charge.success',
      payloadHash: await sha256Hex(rawBytes),
    });
    if (
      outcome.order_id &&
      ['success', 'already_paid', 'duplicate_event'].includes(outcome.outcome)
    ) {
      waitUntil(deliverOrderTickets(outcome.order_id));
    }
    return NextResponse.json({ received: true, outcome: outcome.outcome });
  } catch (error) {
    console.error('Paystack webhook processing failed', error);
    return NextResponse.json(
      { error: 'Webhook processing failed.' },
      { status: 500 },
    );
  }
}
