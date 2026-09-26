import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import {
  databaseRowToOrganiserEvent,
  isRetiredSeedEvent,
  publicEventSelect,
  type DatabaseEventRow,
} from '@/lib/database-events';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function listEvents() {
  const { data, error } = await getSupabaseAdminClient()
    .from('events')
    .select(publicEventSelect)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as unknown as DatabaseEventRow[])
    .filter((event) => !isRetiredSeedEvent(event))
    .map(databaseRowToOrganiserEvent);
}

export async function GET() {
  if (!(await getAuthenticatedAdmin())) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    return NextResponse.json({ events: await listEvents() });
  } catch (error) {
    console.error('Unable to load admin events', error);
    return NextResponse.json(
      { error: 'We could not load event submissions.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const adminAccount = await getAuthenticatedAdmin();
  if (!adminAccount) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const action = typeof body.action === 'string' ? body.action : 'review';
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  try {
    const client = getSupabaseAdminClient();
    let auditAction: string;
    let auditMetadata: Record<string, unknown>;

    if (action === 'feature') {
      if (typeof body.featured !== 'boolean') {
        return NextResponse.json(
          { error: 'Invalid request.' },
          { status: 400 },
        );
      }
      if (body.featured) {
        const { data: event, error: eligibilityError } = await client
          .from('events')
          .select('organisers!inner(verified_at)')
          .eq('id', id)
          .single();
        if (eligibilityError) throw eligibilityError;
        const organiser = event.organisers as
          | { verified_at: string | null }
          | { verified_at: string | null }[];
        const verifiedAt = Array.isArray(organiser)
          ? organiser[0]?.verified_at
          : organiser?.verified_at;
        if (!verifiedAt)
          return NextResponse.json(
            { error: 'Only verified organiser events can be featured.' },
            { status: 409 },
          );
      }
      const { data, error } = await client
        .from('events')
        .update({
          featured: body.featured,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'published')
        .gt('ends_at', new Date().toISOString())
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          {
            error: 'Only published events that have not ended can be featured.',
          },
          { status: 409 },
        );
      }
      auditAction = body.featured ? 'event.featured' : 'event.unfeatured';
      auditMetadata = { featured: body.featured };
    } else if (action === 'review' && typeof body.approved === 'boolean') {
      const approved = body.approved;
      if (approved) {
        const { data: event, error: eventError } = await client
          .from('events')
          .select(
            'organiser_id,organisers!inner(verified_at),ticket_types(standard_price_kobo,price_kobo,early_bird_price_kobo,quantity_total,quantity_sold,quantity_reserved,active)',
          )
          .eq('id', id)
          .single();
        if (eventError) throw eventError;
        const relation = event.organisers as
          | { verified_at: string | null }
          | { verified_at: string | null }[];
        const verifiedAt = Array.isArray(relation)
          ? relation[0]?.verified_at
          : relation?.verified_at;
        if (!verifiedAt) {
          const ticketTypes = event.ticket_types as Array<{
            standard_price_kobo: number | string;
            price_kobo: number | string;
            early_bird_price_kobo: number | string | null;
            quantity_total: number;
            quantity_sold: number;
            quantity_reserved: number;
            active: boolean;
          }>;
          const free =
            ticketTypes.length > 0 &&
            ticketTypes.every(
              (ticket) =>
                Number(ticket.standard_price_kobo) === 0 &&
                Number(ticket.price_kobo) === 0 &&
                ticket.early_bird_price_kobo === null,
            );
          const capacity = ticketTypes.reduce(
            (total, ticket) =>
              total +
              (ticket.active
                ? ticket.quantity_total
                : ticket.quantity_sold + ticket.quantity_reserved),
            0,
          );
          if (!free || capacity > 100)
            return NextResponse.json(
              {
                error:
                  'Unverified organisers can publish free events with a maximum of 100 tickets.',
              },
              { status: 409 },
            );
          const { count, error: countError } = await client
            .from('events')
            .select('id', { count: 'exact', head: true })
            .eq('organiser_id', event.organiser_id)
            .eq('status', 'published')
            .neq('id', id);
          if (countError) throw countError;
          if ((count || 0) >= 2)
            return NextResponse.json(
              {
                error:
                  'Unverified organisers can publish a maximum of 2 events.',
              },
              { status: 409 },
            );
        }
      }
      const status = approved ? 'published' : 'rejected';
      const { data, error } = await client
        .from('events')
        .update({
          status,
          featured: false,
          published_at: approved ? new Date().toISOString() : null,
          rejection_reason: approved
            ? null
            : 'Please clarify the refund policy before resubmitting.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'submitted')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { error: 'This submission is no longer awaiting review.' },
          { status: 409 },
        );
      }
      auditAction = approved ? 'event.published' : 'event.rejected';
      auditMetadata = { approved };
    } else {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const { error: auditError } = await client.from('audit_logs').insert({
      action: auditAction,
      entity_type: 'event',
      entity_id: id,
      metadata: { actor_admin_id: adminAccount.id, ...auditMetadata },
    });
    if (auditError) console.error('Admin event audit failed', auditError);

    return NextResponse.json({ events: await listEvents() });
  } catch (error) {
    console.error('Unable to review event', error);
    const message = error instanceof Error ? error.message : '';
    if (
      message.includes('Unverified organiser') ||
      message.includes('verified organiser')
    ) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'We could not update this event.' },
      { status: 500 },
    );
  }
}
