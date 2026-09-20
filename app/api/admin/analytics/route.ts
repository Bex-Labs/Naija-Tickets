import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import type { AdminSalesAnalytics } from '@/lib/admin-analytics';

export async function GET() {
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  if (!(await getAuthenticatedAdmin())) {
    return respond({ error: 'Unauthorised.' }, 401);
  }
  try {
    const { data, error } = await getSupabaseAdminClient().rpc(
      'admin_sales_analytics',
    );
    if (error) throw error;
    return respond(data as AdminSalesAnalytics);
  } catch (error) {
    console.error('Unable to load admin sales analytics', error);
    return respond(
      { error: 'We could not load sales analytics. Please try again.' },
      500,
    );
  }
}
