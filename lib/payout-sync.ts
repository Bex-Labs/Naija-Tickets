import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { reconcileSubaccount } from '@/lib/paystack-settlements';

export type PayoutSyncAccount = {
  organiser_id: string;
  subaccount_code: string;
  last_synced_at: string | null;
  needs_attention: boolean;
};
export async function syncOrganiserPayouts(userId: string) {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc('payout_sync_accounts', {
    p_user_id: userId,
  });
  if (error) throw error;
  const accounts = (data ?? []) as PayoutSyncAccount[];
  const testMode = !process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_');
  if (testMode) return { testMode, accounts };
  const signal = AbortSignal.timeout(20_000);
  for (const account of accounts) {
    if (signal.aborted) break;
    const { data: claimed, error: claimError } = await client.rpc(
      'claim_payout_sync',
      {
        p_organiser_id: account.organiser_id,
        p_code: account.subaccount_code,
      },
    );
    if (claimError) throw claimError;
    if (!claimed) continue;
    try {
      await reconcileSubaccount(
        account.subaccount_code,
        async (settlement, transactions) => {
          const { error: recordError } = await client.rpc(
            'record_paystack_settlement',
            {
              p_organiser_id: account.organiser_id,
              p_code: account.subaccount_code,
              p_settlement: settlement,
              p_transactions: transactions,
            },
          );
          if (recordError) throw recordError;
        },
        signal,
      );
      account.last_synced_at = new Date().toISOString();
      account.needs_attention = false;
    } catch {
      // Keep the last confirmed values. Never mark a payout paid on a failed sync.
      account.needs_attention = true;
    }
    const { error: stateError } = await client
      .from('payout_sync_state')
      .update({
        last_synced_at: account.last_synced_at,
        needs_attention: account.needs_attention,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq('organiser_id', account.organiser_id)
      .eq('subaccount_code', account.subaccount_code);
    if (stateError) throw stateError;
  }
  return { testMode, accounts };
}
