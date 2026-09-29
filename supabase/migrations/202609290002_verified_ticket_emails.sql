-- Verified purchase receipts, retry throttling and valid admission details only.
create or replace function public.claim_ticket_delivery_v2(p_order_id uuid)
returns table (
  outcome text,
  delivery_id uuid,
  recipient_email text,
  order_reference text,
  event_title text,
  event_date timestamptz,
  event_venue text,
  event_city text,
  event_address text,
  event_timezone text,
  event_timezone_label text,
  tickets jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype;
  delivery public.ticket_deliveries%rowtype;
  ticket_payload jsonb;
  selected_event public.events%rowtype;
begin
  select * into locked_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or locked_order.status <> 'paid' or not exists (select 1 from public.payments p where p.order_id=locked_order.id and p.status='verified' and p.amount_kobo=locked_order.total_kobo and p.currency=locked_order.currency) then
    return query select 'not_ready', null::uuid, null::text, null::text, null::text, null::timestamptz, null::text, null::text, null::text, null::text, null::text, '[]'::jsonb;
    return;
  end if;

  if locked_order.personal_data_erased_at is not null then
    return query select 'suppressed', null::uuid, null::text, locked_order.reference, null::text, null::timestamptz, null::text, null::text, null::text, null::text, null::text, '[]'::jsonb;
    return;
  end if;

  select * into selected_event
  from public.events
  where id = locked_order.event_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attendee_name', ticket.attendee_name,
        'attendee_email', ticket.attendee_email,
        'display_code', ticket.display_code,
        'ticket_type', ticket_type.name
      ) order by order_item.id, ticket.attendee_index
    ),
    '[]'::jsonb
  ) into ticket_payload
  from public.tickets as ticket
  join public.order_items as order_item on order_item.id = ticket.order_item_id
  join public.ticket_types as ticket_type on ticket_type.id = order_item.ticket_type_id
  where order_item.order_id = locked_order.id and ticket.status in ('valid','used');

  insert into public.ticket_deliveries (order_id, recipient_email)
  values (locked_order.id, locked_order.purchaser_email)
  on conflict (order_id) do nothing;

  select * into delivery
  from public.ticket_deliveries
  where order_id = locked_order.id
  for update;

  if delivery.status = 'sent' then
    return query select 'already_sent', delivery.id, delivery.recipient_email, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, selected_event.city, selected_event.address, selected_event.timezone, selected_event.timezone_label, ticket_payload;
    return;
  end if;

  if delivery.status = 'suppressed' then
    return query select 'suppressed', delivery.id, null::text, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, selected_event.city, selected_event.address, selected_event.timezone, selected_event.timezone_label, '[]'::jsonb;
    return;
  end if;

  if delivery.status = 'failed' and delivery.claimed_at > now() - interval '1 minute' then
    return query select 'retry_later', delivery.id, null::text, locked_order.reference, null::text, null::timestamptz, null::text, null::text, null::text, null::text, null::text, '[]'::jsonb;
    return;
  end if;

  if delivery.status = 'processing'
    and delivery.claimed_at > now() - interval '30 minutes' then
    return query select 'in_progress', delivery.id, delivery.recipient_email, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, selected_event.city, selected_event.address, selected_event.timezone, selected_event.timezone_label, ticket_payload;
    return;
  end if;

  update public.ticket_deliveries
  set
    status = 'processing',
    attempts = attempts + 1,
    claimed_at = now(),
    last_error = null,
    updated_at = now()
  where id = delivery.id
  returning * into delivery;

  return query select 'send', delivery.id, delivery.recipient_email, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, selected_event.city, selected_event.address, selected_event.timezone, selected_event.timezone_label, ticket_payload;
end;
$$;

revoke all on function public.claim_ticket_delivery_v2(uuid) from public;
grant execute on function public.claim_ticket_delivery_v2(uuid) to service_role;

create function public.claim_ticket_delivery_v3(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claim record; receipt public.orders%rowtype;
begin
  select * into claim from public.claim_ticket_delivery_v2(p_order_id);
  if claim.outcome <> 'send' then return jsonb_build_object('outcome',claim.outcome); end if;
  select * into receipt from public.orders where id=p_order_id;
  return to_jsonb(claim) || jsonb_build_object('total_kobo',receipt.total_kobo,'currency',receipt.currency,'paid_at',receipt.paid_at);
end;
$$;
revoke all on function public.claim_ticket_delivery_v2(uuid),public.claim_ticket_delivery_v3(uuid) from public,anon,authenticated;
grant execute on function public.claim_ticket_delivery_v2(uuid),public.claim_ticket_delivery_v3(uuid) to service_role;
