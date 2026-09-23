import { NextResponse } from 'next/server';
import {
  databaseRowToOrganiserEvent,
  isRetiredSeedEvent,
  publicEventSelect,
  type DatabaseEventRow,
} from '@/lib/database-events';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';
import { ensureOrganiser, organiserIdsForUser } from '@/lib/organiser-account';
import { parseOrganiserEventInput } from '@/lib/organiser-event';
import { cities, stateForCity } from '@/lib/events';

async function listEvents(userId: string) {
  const client = getSupabaseAdminClient();
  const organiserIds = await organiserIdsForUser(userId);
  if (!organiserIds.length) return [];

  const { data, error } = await client
    .from('events')
    .select(publicEventSelect)
    .in('organiser_id', organiserIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as unknown as DatabaseEventRow[])
    .filter((event) => !isRetiredSeedEvent(event))
    .map(databaseRowToOrganiserEvent);
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  try {
    const organiserId = await ensureOrganiser(user);
    const client = getSupabaseAdminClient();
    const [events, organiserResult] = await Promise.all([
      listEvents(user.id),
      client
        .from('organisers')
        .select('name,description,verified_at')
        .eq('id', organiserId)
        .single(),
    ]);
    if (organiserResult.error) throw organiserResult.error;
    return NextResponse.json({
      events,
      organiser: {
        name: organiserResult.data.name,
        description: organiserResult.data.description || '',
        verified: Boolean(organiserResult.data.verified_at),
      },
    });
  } catch (error) {
    console.error('Unable to load organiser events', error);
    return NextResponse.json(
      { error: 'We could not load your events.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = parseOrganiserEventInput(body);
  if (!parsed.value) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const values = parsed.value;
  if (!cities.includes(values.city)) {
    return NextResponse.json(
      { error: 'Choose a supported Nigerian city.' },
      { status: 400 },
    );
  }

  try {
    const client = getSupabaseAdminClient();
    const organiserId = await ensureOrganiser(user);
    const { data: categoryRow, error: categoryError } = await client
      .from('categories')
      .select('id')
      .eq('name', values.category)
      .maybeSingle();
    if (categoryError) throw categoryError;
    if (!categoryRow) {
      return NextResponse.json(
        { error: 'Choose a supported event category.' },
        { status: 400 },
      );
    }

    const { data: savedId, error: saveError } = await client.rpc(
      'save_organiser_event_v2',
      {
        p_user_id: user.id,
        p_event_id: values.id,
        p_organiser_id: organiserId,
        p_category_id: categoryRow.id,
        p_title: values.title,
        p_presenter_line: values.presenterLine,
        p_description: values.description,
        p_venue_name: values.venue,
        p_address: values.address,
        p_directions_url: values.directionsUrl,
        p_city: values.city,
        p_state: stateForCity(values.city),
        p_timezone: 'Africa/Lagos',
        p_timezone_label: values.timezoneLabel,
        p_starts_at: values.startsAt,
        p_ends_at: values.endsAt,
        p_sales_start_at: values.salesStartAt,
        p_sales_end_at: values.salesEndAt,
        p_status: values.status,
        p_image_path: values.imageUrl,
        p_organiser_name: values.organiserDisplayName,
        p_organiser_description: values.organiserAbout,
        p_schedule: values.schedule.map((item, sortOrder) => ({
          time: item.time,
          title: item.title,
          sort_order: sortOrder,
        })),
        p_policies: values.policies.map((policy, sortOrder) => ({
          text: policy.text,
          sort_order: sortOrder,
        })),
        p_ticket_types: values.ticketTypes.map((ticket, sortOrder) => ({
          id: ticket.id,
          name: ticket.name,
          description: ticket.description,
          price_kobo: ticket.priceKobo,
          early_bird_price_kobo: ticket.earlyBirdPriceKobo,
          early_bird_ends_at: ticket.earlyBirdEndAt,
          quantity_total: ticket.quantityTotal,
          min_per_order: ticket.minPerOrder,
          max_per_order: ticket.maxPerOrder,
          sales_start_at: values.salesStartAt,
          sales_end_at: values.salesEndAt,
          inclusions: ticket.inclusions,
          sort_order: sortOrder,
          active: ticket.active,
        })),
      },
    );
    if (saveError) throw saveError;

    const events = await listEvents(user.id);
    return NextResponse.json({
      event: events.find((event) => event.id === savedId),
      events,
      organiser: {
        name: values.organiserDisplayName,
        description: values.organiserAbout,
      },
    });
  } catch (error) {
    console.error('Unable to save organiser event', error);
    const message = error instanceof Error ? error.message : '';
    const safeMessage = [
      'capacity',
      'inventory',
      'ticket tier',
      'early bird',
      'standard price',
      'sales end',
      'event end',
      'Event not found',
      'Unverified organiser',
      'Unverified organisers',
    ].some((term) => message.toLowerCase().includes(term.toLowerCase()))
      ? message
      : 'We could not save this event. Please try again.';
    return NextResponse.json(
      { error: safeMessage },
      { status: safeMessage === message ? 409 : 500 },
    );
  }
}
