import { getSupabaseAdminClient } from '@/lib/supabase/server';

export type PaymentOutcome = {
  outcome: string;
  order_id: string | null;
  order_reference: string | null;
  ticket_count: number;
};

export async function findPaystackPayment(reference: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('payments')
    .select('id,order_id,provider_reference,amount_kobo,currency,status')
    .eq('provider', 'paystack')
    .eq('provider_reference', reference)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findOrderReference(orderId: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('orders')
    .select('reference')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data?.reference || null;
}

export async function finalizePaystackPayment(input: {
  reference: string;
  status: string;
  amountKobo: number;
  currency: string;
  transactionId: string;
  payload: unknown;
  eventId?: string;
  eventType?: string;
  payloadHash?: string;
}) {
  const { data, error } = await getSupabaseAdminClient().rpc(
    'finalize_paystack_payment',
    {
      p_provider_reference: input.reference,
      p_provider_status: input.status,
      p_amount_kobo: input.amountKobo,
      p_currency: input.currency,
      p_provider_transaction_id: input.transactionId,
      p_payload: input.payload,
      p_provider_event_id: input.eventId || null,
      p_event_type: input.eventType || null,
      p_payload_hash: input.payloadHash || null,
    },
  );
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | PaymentOutcome
    | undefined;
  if (!row) throw new Error('Payment finalization returned no result.');
  return row;
}

export async function recordPaystackVerification(
  reference: string,
  status: string,
  payload: unknown,
) {
  const mapped =
    status === 'failed'
      ? 'failed'
      : status === 'abandoned'
        ? 'abandoned'
        : 'pending';
  const { error } = await getSupabaseAdminClient()
    .from('payments')
    .update({
      status: mapped,
      provider_status: status,
      raw_verification: payload,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'paystack')
    .eq('provider_reference', reference)
    .neq('status', 'verified');
  if (error) throw error;
}
