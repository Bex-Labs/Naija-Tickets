import { NextResponse } from 'next/server';
import type { OrganiserPayoutTracking } from '@/lib/organiser-payouts';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

export async function GET(request: Request) {
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
    });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return respond({ error: 'Authentication required.' }, 401);
    const { data, error } = await getSupabaseAdminClient().rpc(
      'organiser_payout_tracking',
      { p_user_id: user.id },
    );
    if (error) throw error;
    return respond(data as OrganiserPayoutTracking);
  } catch (error) {
    console.error('Unable to load organiser payouts', error);
    return respond(
      { error: 'We could not load payouts. Please try again.' },
      500,
    );
  }
}
