import { NextResponse } from 'next/server';
import { waitUntil } from 'cloudflare:workers';
import {
  finalizePaystackPayment,
  findOrderReference,
  findPaystackPayment,
  recordPaystackVerification,
} from '@/lib/payments';
import {
  isValidPaystackReference,
  verifyPaystackTransaction,
} from '@/lib/paystack';
import { deliverOrderTickets } from '@/lib/ticket-delivery';

function statusRedirect(
  request: Request,
  result: string,
  reference = '',
  delivery = '',
  paymentReference = '',
) {
  const url = new URL('/payment/status', request.url);
  url.searchParams.set('result', result);
  if (reference) url.searchParams.set('reference', reference);
  if (delivery) url.searchParams.set('delivery', delivery);
  if (paymentReference) {
    url.searchParams.set('paymentReference', paymentReference);
  }
  return NextResponse.redirect(url, 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference =
    url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
  if (!isValidPaystackReference(reference)) {
    return statusRedirect(request, 'invalid');
  }

  let orderReference = '';
  try {
    const expectedPayment = await findPaystackPayment(reference);
    if (!expectedPayment) return statusRedirect(request, 'invalid');
    orderReference = (await findOrderReference(expectedPayment.order_id)) || '';
    if (!orderReference) return statusRedirect(request, 'invalid');

    const verification = await verifyPaystackTransaction(reference);
    const transaction = verification.data;
    if (transaction.reference !== reference) {
      return statusRedirect(request, 'invalid');
    }

    if (transaction.status !== 'success') {
      await recordPaystackVerification(
        reference,
        transaction.status,
        verification,
      );
      return statusRedirect(
        request,
        ['failed', 'abandoned'].includes(transaction.status)
          ? 'failed'
          : 'pending',
        orderReference,
        '',
        reference,
      );
    }

    const amountKobo = Number(transaction.amount);
    if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) {
      return statusRedirect(request, 'invalid', orderReference, '', reference);
    }
    const outcome = await finalizePaystackPayment({
      reference,
      status: transaction.status,
      amountKobo,
      currency: transaction.currency,
      transactionId: String(transaction.id),
      payload: verification,
    });

    if (
      ['success', 'already_paid', 'duplicate_event'].includes(outcome.outcome)
    ) {
      let delivery = 'not_ready';
      if (outcome.order_id) {
        waitUntil(deliverOrderTickets(outcome.order_id));
        delivery = 'in_progress';
      }
      return statusRedirect(
        request,
        'success',
        outcome.order_reference || '',
        delivery,
        reference,
      );
    }
    if (outcome.outcome === 'reservation_expired') {
      return statusRedirect(
        request,
        'expired',
        outcome.order_reference || '',
        '',
        reference,
      );
    }
    return statusRedirect(
      request,
      'failed',
      outcome.order_reference || '',
      '',
      reference,
    );
  } catch (error) {
    console.error('Paystack callback verification failed', error);
    return statusRedirect(request, 'pending', orderReference, '', reference);
  }
}
