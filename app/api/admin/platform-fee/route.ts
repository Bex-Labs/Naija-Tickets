import { NextResponse } from 'next/server';
import { verifyAdminCredentials } from '@/lib/admin-auth';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import {
  getPlatformFeeRule,
  platformFeeRuleFromAdminInput,
  platformFeeStorageValue,
} from '@/lib/checkout';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function GET() {
  if (!(await getAuthenticatedAdmin())) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  return NextResponse.json({ feeRule: await getPlatformFeeRule() });
}

export async function PATCH(request: Request) {
  const adminAccount = await getAuthenticatedAdmin();
  if (!adminAccount) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const rule = platformFeeRuleFromAdminInput(body);
  if (!rule || !currentPassword) {
    return NextResponse.json(
      {
        error:
          'Choose a valid fee from 0% to 25% or ₦0 to ₦100,000 per ticket.',
      },
      { status: 400 },
    );
  }
  if (
    !(await verifyAdminCredentials(
      adminAccount.username,
      currentPassword,
      adminAccount,
    ))
  ) {
    return NextResponse.json(
      { error: 'Your current password is incorrect.' },
      { status: 400 },
    );
  }

  try {
    const storedRule = platformFeeStorageValue(rule);
    const { data, error } = await getSupabaseAdminClient().rpc(
      'set_platform_fee_rule',
      {
        p_fee_type: storedRule.type,
        p_fee_value:
          rule.type === 'percentage'
            ? rule.basisPoints
            : rule.fixedKoboPerTicket,
        p_actor_admin_id: adminAccount.id,
      },
    );
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.outcome !== 'updated') {
      throw new Error('Platform fee update returned an invalid result.');
    }
    return NextResponse.json({ feeRule: rule });
  } catch (error) {
    console.error('Platform fee update failed', error);
    return NextResponse.json(
      { error: 'The platform fee could not be saved.' },
      { status: 500 },
    );
  }
}
