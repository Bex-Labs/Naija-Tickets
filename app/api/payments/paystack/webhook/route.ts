import { NextResponse } from 'next/server';
import { waitUntil } from 'cloudflare:workers';
import { finalizePaystackPayment } from '@/lib/payments';
import {
  isValidPaystackReference,
  sha256Hex,
  verifyPaystackWebhookSignature,
} from '@/lib/paystack';
import { deliverOrderTickets } from '@/lib/ticket-delivery';

type PaystackWebhook = {
  event?: unknown;
  data?: unknown;
};

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
