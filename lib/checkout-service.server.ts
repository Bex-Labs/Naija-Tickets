import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  validateReservationTypes,
  type ReservationInput,
} from './checkout-service.ts';
export async function validateStoredReservationTypes(input: ReservationInput) {
  const { data, error } = await getSupabaseAdminClient()
    .from('ticket_types')
    .select('id,admissions_per_ticket')
    .eq('event_id', input.eventId)
    .in(
      'id',
      input.items.map((item) => item.ticketTypeId),
    )
    .abortSignal(AbortSignal.timeout(8000));
  if (error) throw error;
  validateReservationTypes(
    input,
    new Map(
      (data ?? []).map((row) => [row.id, row.admissions_per_ticket as number]),
    ),
  );
}
