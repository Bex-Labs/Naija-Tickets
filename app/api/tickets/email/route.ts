import { NextResponse } from 'next/server';
import { isValidOrderReference } from '@/lib/order-ticket-access';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  deliverOrderTickets,
  ticketEmailConfigured,
} from '@/lib/ticket-delivery';
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
async function findOrder(reference: unknown) {
  if (typeof reference !== 'string' || !isValidOrderReference(reference))
    return null;
  const db = getSupabaseAdminClient();
  const { data: order, error } = await db
    .from('orders')
    .select('id,status,total_kobo,currency')
    .eq('reference', reference)
    .is('personal_data_erased_at', null)
    .eq('status', 'paid')
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const { data: payment, error: paymentError } = await db
    .from('payments')
    .select('id')
    .eq('order_id', order.id)
    .eq('status', 'verified')
    .eq('amount_kobo', order.total_kobo)
    .eq('currency', order.currency)
    .limit(1)
    .maybeSingle();
  if (paymentError) throw paymentError;
  return payment ? order : null;
}
export async function GET(request: Request) {
  try {
    const order = await findOrder(
      new URL(request.url).searchParams.get('reference'),
    );
    if (!order)
      return respond(
        { error: 'Email confirmation is unavailable for this order.' },
        404,
      );
    const { data, error } = await getSupabaseAdminClient()
      .from('ticket_deliveries')
      .select('status')
      .eq('order_id', order.id)
      .maybeSingle();
    if (error) throw error;
    return respond({
      status: data?.status || 'pending',
      enabled: ticketEmailConfigured(),
    });
  } catch {
    return respond({ error: 'Could not check email status.' }, 500);
  }
}
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const order = await findOrder(
      body && typeof body === 'object' && 'reference' in body
        ? body.reference
        : null,
    );
    if (!order)
      return respond(
        { error: 'Email confirmation is unavailable for this order.' },
        404,
      );
    if (!ticketEmailConfigured())
      return respond(
        {
          error:
            'Email delivery is temporarily unavailable. You can view and save your tickets here.',
        },
        503,
      );
    const status = await deliverOrderTickets(order.id);
    // The recipient always comes from the original order, never the request.
    return respond({ status }, status === 'failed' ? 502 : 200);
  } catch {
    return respond(
      { error: 'The email could not be sent. Please try again later.' },
      500,
    );
  }
}
