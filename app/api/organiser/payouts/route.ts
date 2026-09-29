import { NextResponse } from 'next/server';
import { syncOrganiserPayouts } from '@/lib/payout-sync';
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
    const sync = await syncOrganiserPayouts(user.id);
    const { data, error } = await getSupabaseAdminClient().rpc(
      'organiser_payout_tracking_v2',
      { p_user_id: user.id, p_live: !sync.testMode },
    );
    if (error) throw error;
    const client = getSupabaseAdminClient();
    const { data: memberships, error: membershipError } = await client
      .from('organiser_memberships')
      .select('organiser_id')
      .eq('user_id', user.id);
    if (membershipError) throw membershipError;
    const ids = (memberships ?? []).map((row) => row.organiser_id as string);
    const { data: banks, error: bankError } = ids.length
      ? await client
          .from('organiser_payout_accounts')
          .select(
            'settlement_bank_name,settlement_account_last4,direct_settlement_enabled',
          )
          .in('organiser_id', ids)
      : { data: [], error: null };
    if (bankError) throw bankError;
    return respond({
      ...(data as OrganiserPayoutTracking),
      sync: {
        testMode: sync.testMode,
        needsAttention: sync.accounts.some(
          (account) => account.needs_attention,
        ),
        lastSyncedAt:
          sync.accounts.length &&
          sync.accounts.every((account) => account.last_synced_at)
            ? sync.accounts.map((account) => account.last_synced_at!).sort()[0]
            : null,
        banks: (banks ?? []).map((bank) => ({
          name: bank.settlement_bank_name,
          last4: bank.settlement_account_last4,
          enabled: bank.direct_settlement_enabled,
        })),
      },
    });
  } catch (error) {
    console.error('Unable to load organiser payouts', error);
    return respond(
      { error: 'We could not load payouts. Please try again.' },
      500,
    );
  }
}
