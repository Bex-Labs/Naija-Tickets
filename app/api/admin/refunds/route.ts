import { NextResponse } from 'next/server';
import { parsePaystackRefund } from '@/lib/admin-refunds';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { getPaystackRefund } from '@/lib/paystack';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  const admin = await getAuthenticatedAdmin();
  if (!admin) return respond({ error: 'Unauthorised.' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return respond({ error: 'Invalid request origin.' }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'Invalid request.' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return respond({ error: 'Invalid request.' }, 400);
  }
  const values = body as Record<string, unknown>;
  const orderId = values.orderId;
  const refundId = values.refundId;
  const reason = values.reason;
  if (
    typeof orderId !== 'string' ||
    !uuidPattern.test(orderId) ||
    typeof refundId !== 'string' ||
    !/^[0-9]{1,20}$/.test(refundId) ||
    typeof reason !== 'string' ||
    reason.trim().length > 500
  ) {
    return respond(
      { error: 'Enter a valid order, Paystack refund ID and reason.' },
      400,
    );
  }

  let verified;
  try {
    verified = parsePaystackRefund(
      (await getPaystackRefund(refundId)).data,
      refundId,
    );
  } catch (error) {
    console.error('Paystack refund lookup failed', error);
    return respond(
      {
        error:
          'Paystack could not verify this refund ID. Check it and try again.',
      },
      502,
    );
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc(
      'record_admin_refund',
      {
        p_order_id: orderId,
        p_provider_refund_id: verified.id,
        p_provider_transaction_id: verified.transactionId,
        p_amount_kobo: verified.amountKobo,
        p_currency: verified.currency,
        p_provider_status: verified.providerStatus,
        p_reason: reason.trim(),
        p_admin_actor_id: admin.id,
      },
    );
    if (error) {
      if (['22023', '23505'].includes(error.code)) {
        return respond({ error: error.message }, 409);
      }
      throw error;
    }
    return respond({ refund: data });
  } catch (error) {
    console.error('Admin refund record failed', error);
    return respond(
      { error: 'The refund could not be recorded. Please try again.' },
      500,
    );
  }
}
