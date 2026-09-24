import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import {
  transactionStatuses,
  type AdminTransactionsPage,
  type TransactionMethodFilter,
} from '@/lib/admin-transactions';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  if (!(await getAuthenticatedAdmin())) {
    return respond({ error: 'Unauthorised.' }, 401);
  }

  const params = new URL(request.url).searchParams;
  const search = (params.get('search') || '').trim();
  const status = params.get('status') || 'all';
  const method = params.get('method') || 'all';
  const pageText = params.get('page') || '1';
  const page = Number(pageText);
  if (
    search.length > 100 ||
    !transactionStatuses.includes(
      status as (typeof transactionStatuses)[number],
    ) ||
    !(['all', 'paystack', 'demo_free'] as TransactionMethodFilter[]).includes(
      method as TransactionMethodFilter,
    ) ||
    !/^\d+$/.test(pageText) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000
  ) {
    return respond({ error: 'Invalid transaction filters.' }, 400);
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc(
      'admin_transactions',
      {
        p_search: search,
        p_status: status,
        p_method: method,
        p_page: page,
      },
    );
    if (error) throw error;
    return respond(data as AdminTransactionsPage);
  } catch (error) {
    console.error('Unable to load admin transactions', error);
    return respond(
      { error: 'We could not load transactions. Please try again.' },
      500,
    );
  }
}
