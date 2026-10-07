import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import type { AdminVisitorAnalytics } from '@/lib/site-visitors';

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
      'admin_visitor_analytics',
    );
    if (error) throw error;
    return respond(data as AdminVisitorAnalytics);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    console.error('Unable to load admin visitors', { code });
    if (['PGRST202', '42883', '42P01'].includes(code)) {
      return respond(
        {
          error:
            'Visitor tracking is not ready yet. The database update needs to be applied.',
        },
        503,
      );
    }
    return respond(
      { error: 'Visitors could not be loaded. Please try again.' },
      500,
    );
  }
}
