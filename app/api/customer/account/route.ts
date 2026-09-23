import { NextResponse } from 'next/server';
import { accountHomeFromMetadata } from '@/lib/auth-destination';
import { parseCustomerProfileInput } from '@/lib/customer-profile';
import {
  buildCustomerSavedEvents,
  buildCustomerPurchases,
  type CustomerAccount,
} from '@/lib/customer-account';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

type Relation<T> = T | T[] | null;

function first<T>(relation: Relation<T>) {
  return Array.isArray(relation) ? relation[0] : relation;
}

const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
  });

async function customer(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return { response: respond({ error: 'Authentication required.' }, 401) };
  if (accountHomeFromMetadata(user.user_metadata) !== '/account') {
    return {
      response: respond({ error: 'A customer account is required.' }, 403),
    };
  }
  return { user };
}

export async function GET(request: Request) {
  try {
    const auth = await customer(request);
    if ('response' in auth) return auth.response;
    const { user } = auth;
    const admin = getSupabaseAdminClient();
    const [
      { data: profile, error: profileError },
      { data: orders, error: ordersError },
      { data: savedEvents, error: savedEventsError },
    ] = await Promise.all([
      admin
        .from('profiles')
        .select('full_name,phone')
        .eq('id', user.id)
        .single(),
      admin
        .from('orders')
        .select(
          'id,reference,status,currency,subtotal_kobo,discount_kobo,fee_kobo,total_kobo,created_at,paid_at,event_id',
        )
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('saved_events')
        .select('event_id,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);
    if (profileError) throw profileError;
    if (ordersError) throw ordersError;
    if (savedEventsError) throw savedEventsError;

    const orderRows = orders || [];
    const orderIds = orderRows.map((order) => order.id);
    const eventIds = [
      ...new Set([
        ...orderRows.map((order) => order.event_id),
        ...(savedEvents || []).map((saved) => saved.event_id),
      ]),
    ];
    const [
      { data: events, error: eventsError },
      { data: rawItems, error: itemsError },
      { data: payments, error: paymentsError },
    ] = await Promise.all([
      eventIds.length
        ? admin
            .from('events')
            .select(
              'id,title,slug,starts_at,timezone,timezone_label,venue_name,city,image_path,status',
            )
            .in('id', eventIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? admin
            .from('order_items')
            .select('id,order_id,quantity,ticket_types(name)')
            .in('order_id', orderIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? admin
            .from('payments')
            .select('order_id,status,created_at')
            .in('order_id', orderIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsError) throw eventsError;
    if (itemsError) throw itemsError;
    if (paymentsError) throw paymentsError;
    const items = (
      (rawItems || []) as unknown as Array<{
        id: string;
        order_id: string;
        quantity: number;
        ticket_types: Relation<{ name: string }>;
      }>
    ).map((item) => ({
      id: item.id,
      order_id: item.order_id,
      quantity: item.quantity,
      ticketType: first(item.ticket_types)?.name || 'Admission',
    }));
    const itemIds = items.map((item) => item.id);
    const { data: tickets, error: ticketsError } = itemIds.length
      ? await admin
          .from('tickets')
          .select(
            'id,order_item_id,attendee_name,display_code,status,issued_at',
          )
          .in('order_item_id', itemIds)
          .order('issued_at', { ascending: true })
      : { data: [], error: null };
    if (ticketsError) throw ticketsError;

    const account: CustomerAccount = {
      profile: {
        name: profile.full_name,
        email: user.email || '',
        phone: profile.phone || '',
      },
      purchases: buildCustomerPurchases(
        orderRows,
        events || [],
        items,
        tickets || [],
        payments || [],
      ),
      savedEvents: buildCustomerSavedEvents(savedEvents || [], events || []),
    };
    return respond(account);
  } catch (error) {
    console.error('Unable to load customer account', error);
    return respond(
      { error: 'We could not load your tickets. Please try again.' },
      500,
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await customer(request);
    if ('response' in auth) return auth.response;
    const parsed = parseCustomerProfileInput(
      await request.json().catch(() => null),
    );
    if (!parsed.value) return respond({ error: parsed.error }, 400);
    const { fullName, phone } = parsed.value;
    const client = getSupabaseAdminClient();
    const updatedAt = new Date().toISOString();
    const [profileResult, authResult] = await Promise.all([
      client
        .from('profiles')
        .update({ full_name: fullName, phone, updated_at: updatedAt })
        .eq('id', auth.user.id)
        .select('id')
        .single(),
      client.auth.admin.updateUserById(auth.user.id, {
        user_metadata: {
          ...auth.user.user_metadata,
          full_name: fullName,
          phone,
        },
      }),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (authResult.error) throw authResult.error;
    return respond({
      profile: { name: fullName, email: auth.user.email || '', phone },
    });
  } catch (error) {
    console.error('Unable to update customer profile', error);
    return respond({ error: 'We could not save your profile.' }, 500);
  }
}
