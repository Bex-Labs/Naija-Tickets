import { NextResponse, after } from 'next/server';
import { startCheckoutPayment } from '@/lib/payment-start';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  getTrustedAppOrigin,
  initializePaystackTransaction,
} from '@/lib/paystack';
import { deliverOrderTickets } from '@/lib/ticket-delivery';
import { UUID_PATTERN } from '@/lib/checkout-reservation-validation';
import {
  integrationCompletedUrl,
  requireAttributedPaymentConfiguration,
} from '@/lib/integrations/checkout-sessions.server';
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const values =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (
    typeof values.orderId !== 'string' ||
    !UUID_PATTERN.test(values.orderId) ||
    typeof values.checkoutToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(values.checkoutToken)
  )
    return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });
  // Attribution/mode checks protect hosted orders even at this legacy endpoint.
  try {
    await requireAttributedPaymentConfiguration(
      values.orderId,
      values.checkoutToken,
    );
  } catch {
    return NextResponse.json(
      {
        error: 'This checkout is not available for payment.',
        code: 'CHECKOUT_NOT_CONFIGURED',
      },
      { status: 503 },
    );
  }
  const result = await startCheckoutPayment(
    {
      orderId: values.orderId,
      checkoutToken: values.checkoutToken,
      requestUrl: request.url,
    },
    {
      client: getSupabaseAdminClient(),
      initialize: initializePaystackTransaction,
      origin: getTrustedAppOrigin,
      deliver: (orderId) => after(deliverOrderTickets(orderId)),
      completedUrl: integrationCompletedUrl,
      log: (metadata) =>
        console.info('payment_start', JSON.stringify(metadata)),
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
