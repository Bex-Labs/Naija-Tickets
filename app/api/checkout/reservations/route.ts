import { NextResponse } from 'next/server';
import {
  parseReservationInput,
  createCheckoutToken,
  reservationRpcInput,
  projectReservation,
  reservationFailure,
} from '@/lib/checkout-service';
import { validateStoredReservationTypes } from '@/lib/checkout-service.server';
import { sha256Hex } from '@/lib/paystack';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
import { readIntegrationJson } from '@/lib/integrations/validation';
export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  let body: unknown;
  try {
    body = await readIntegrationJson(request, 262144);
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  try {
    const input = parseReservationInput(body);
    await validateStoredReservationTypes(input);
    const token = createCheckoutToken();
    const { data, error } = await getSupabaseAdminClient().rpc(
      'create_checkout_reservation_v3',
      reservationRpcInput(input, user?.id ?? null, await sha256Hex(token)),
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw Error('Missing reservation.');
    return NextResponse.json({ reservation: projectReservation(row, token) });
  } catch (cause) {
    const error = reservationFailure(cause);
    console.info(
      'checkout_reservation',
      JSON.stringify({ status: error.status }),
    );
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
}
