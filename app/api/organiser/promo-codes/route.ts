import { NextResponse } from 'next/server';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
import { organiserIdsForUser } from '@/lib/organiser-account';
import { parsePromoCodeInput } from '@/lib/promo-codes';

const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
  });

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return respond({ error: 'Authentication required.' }, 401);
    const ids = await organiserIdsForUser(user.id);
    if (!ids.length) return respond({ promoCodes: [] });
    const { data, error } = await getSupabaseAdminClient()
      .from('promo_codes')
      .select(
        'id,event_id,code,discount_type,discount_value,starts_at,ends_at,usage_limit,ticket_type_ids,active,events!inner(organiser_id)',
      )
      .in('events.organiser_id', ids)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return respond({
      promoCodes: (data || []).map(({ events: _events, ...code }) => code),
    });
  } catch (error) {
    console.error('Unable to load promo codes', error);
    return respond({ error: 'We could not load your promo codes.' }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return respond({ error: 'Authentication required.' }, 401);
    const input = parsePromoCodeInput(await request.json().catch(() => null));
    if (!input)
      return respond(
        {
          error:
            'Check the code, discount, dates, usage limit and selected tickets.',
        },
        400,
      );
    const { data, error } = await getSupabaseAdminClient().rpc(
      'create_organiser_promo_code',
      {
        p_user_id: user.id,
        p_event_id: input.eventId,
        p_code: input.code,
        p_discount_type: input.discountType,
        p_discount_value: input.discountValue,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_usage_limit: input.usageLimit,
        p_ticket_type_ids: input.ticketTypeIds,
      },
    );
    if (error) {
      if (error.code === '23505')
        return respond(
          { error: 'This code already exists for the event.' },
          409,
        );
      if (error.message === 'Event not found or access unavailable.')
        return respond({ error: error.message }, 404);
      if (error.message === 'Choose ticket types belonging to this event.')
        return respond({ error: error.message }, 400);
      throw error;
    }
    return respond({ id: data }, 201);
  } catch (error) {
    console.error('Unable to create promo code', error);
    return respond(
      { error: 'We could not create this promo code. Please try again.' },
      500,
    );
  }
}
