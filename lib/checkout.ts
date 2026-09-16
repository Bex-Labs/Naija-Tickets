import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  DEFAULT_PLATFORM_FEE_RULE,
  parsePlatformFeeRule,
} from '@/lib/platform-fee';

export * from '@/lib/platform-fee';

export async function getPlatformFeeRule() {
  try {
    const { data, error } = await getSupabaseAdminClient()
      .from('platform_settings')
      .select('value')
      .eq('key', 'platform_fee')
      .maybeSingle();
    if (error) throw error;
    return parsePlatformFeeRule(data?.value);
  } catch (error) {
    console.error('Platform fee lookup failed', error);
    return DEFAULT_PLATFORM_FEE_RULE;
  }
}
