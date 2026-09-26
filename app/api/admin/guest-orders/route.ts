import { NextResponse } from 'next/server';
import { verifyAdminCredentials } from '@/lib/admin-auth';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { mapGuestOrder, type GuestOrderRow } from '@/lib/guest-orders';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function listGuestOrders() {
  const { data, error } = await getSupabaseAdminClient()
    .from('orders')
    .select(
      'id,reference,status,currency,total_kobo,purchaser_name,purchaser_email,purchaser_phone,created_at,personal_data_erased_at,events(title),order_items(quantity,admissions_per_ticket)',
    )
    .is('customer_id', null)
    .order('created_at', { ascending: false })
    .range(0, 499);
  if (error) throw error;
  return ((data || []) as unknown as GuestOrderRow[]).map(mapGuestOrder);
}

export async function GET() {
  if (!(await getAuthenticatedAdmin())) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  try {
    return NextResponse.json({ orders: await listGuestOrders() });
  } catch (error) {
    console.error('Guest purchase list failed', error);
    return NextResponse.json(
      { error: 'Guest purchases could not be loaded.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
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

  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const confirmation =
    typeof body.confirmation === 'string' ? body.confirmation : '';
  if (
    !UUID_PATTERN.test(orderId) ||
    !currentPassword ||
    confirmation !== 'ERASE'
  ) {
    return NextResponse.json(
      { error: 'Enter your password and type ERASE to confirm.' },
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
    const { data, error } = await getSupabaseAdminClient().rpc(
      'anonymize_guest_order_personal_data',
      {
        p_order_id: orderId,
        p_actor_admin_id: adminAccount.id,
      },
    );
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    const outcome = result?.outcome;
    if (outcome === 'not_found') {
      return NextResponse.json(
        { error: 'Guest purchase not found.' },
        { status: 404 },
      );
    }
    if (outcome === 'not_guest') {
      return NextResponse.json(
        { error: 'Only guest purchase data can be erased here.' },
        { status: 409 },
      );
    }
    if (!['erased', 'already_erased'].includes(outcome)) {
      throw new Error('Guest erasure returned an invalid result.');
    }
    return NextResponse.json({
      orders: await listGuestOrders(),
      outcome,
    });
  } catch (error) {
    console.error('Guest personal data erasure failed', error);
    return NextResponse.json(
      { error: 'Guest personal data could not be erased.' },
      { status: 500 },
    );
  }
}
