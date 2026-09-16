-- Add admin-only guest privacy controls and richer ticket email claims.
-- Financial, ticket validity and audit records remain intact after erasure.

alter table public.orders
  add column if not exists personal_data_erased_at timestamptz;

create index if not exists orders_guest_created_idx
  on public.orders (created_at desc)
  where customer_id is null;

alter table public.ticket_deliveries
  drop constraint if exists ticket_deliveries_status_check;

alter table public.ticket_deliveries
  add constraint ticket_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'suppressed'));

create or replace function public.anonymize_guest_order_personal_data(
  p_order_id uuid,
  p_actor_admin_id text
)
returns table (
  outcome text,
  erased_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype;
  privacy_email text;
  erased_timestamp timestamptz := now();
begin
  select * into locked_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return query select 'not_found', null::timestamptz;
    return;
  end if;

  if locked_order.customer_id is not null then
    return query select 'not_guest', null::timestamptz;
    return;
  end if;

  if locked_order.personal_data_erased_at is not null then
    return query select 'already_erased', locked_order.personal_data_erased_at;
    return;
  end if;

  privacy_email := 'erased+' || replace(locked_order.id::text, '-', '') || '@privacy.naijatickets.invalid';

  update public.orders
  set
    purchaser_name = 'Guest data removed',
    purchaser_email = privacy_email,
    purchaser_phone = 'Removed',
    personal_data_erased_at = erased_timestamp,
    updated_at = erased_timestamp
  where id = locked_order.id;

  update public.order_items as order_item
  set attendee_data = (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', 'Guest attendee ' || attendee.ordinality::text,
          'email', privacy_email
        ) order by attendee.ordinality
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(order_item.attendee_data)
      with ordinality as attendee(value, ordinality)
  )
  where order_item.order_id = locked_order.id;

  update public.tickets as ticket
  set
    attendee_name = 'Guest attendee',
    attendee_email = privacy_email
  from public.order_items as order_item
  where ticket.order_item_id = order_item.id
    and order_item.order_id = locked_order.id;

  update public.payments
  set
    raw_verification = case
      when raw_verification is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'privacy_erased', true,
        'status', provider_status,
        'reference', provider_reference,
        'amount_kobo', amount_kobo,
        'currency', currency,
        'transaction_id', provider_transaction_id,
        'verified_at', verified_at
      ))
    end,
    initialization_response = case
      when initialization_response is null then null
      else jsonb_build_object('privacy_erased', true)
    end,
    authorization_url = null,
    access_code = null,
    updated_at = erased_timestamp
  where order_id = locked_order.id;

  update public.ticket_deliveries
  set
    recipient_email = privacy_email,
    status = 'suppressed',
    claimed_at = null,
    last_error = 'Delivery disabled after personal data erasure.',
    updated_at = erased_timestamp
  where order_id = locked_order.id;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'admin.guest_personal_data_erased',
    'order',
    locked_order.id::text,
    jsonb_build_object(
      'actor_admin_id', p_actor_admin_id,
      'order_reference', locked_order.reference,
      'order_status', locked_order.status,
      'financial_records_retained', true,
      'ticket_codes_retained', true
    )
  );

  return query select 'erased', erased_timestamp;
end;
$$;

revoke all on function public.anonymize_guest_order_personal_data(uuid, text) from public;
grant execute on function public.anonymize_guest_order_personal_data(uuid, text) to service_role;

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

  if not found or locked_order.status <> 'paid' then
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
  where order_item.order_id = locked_order.id;

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

comment on function public.anonymize_guest_order_personal_data(uuid, text)
is 'Atomically erases guest purchaser and attendee PII while preserving financial reconciliation and ticket validity records.';

comment on function public.claim_ticket_delivery_v2(uuid)
is 'Claims one retryable ticket email with complete event details and suppresses delivery after privacy erasure.';

create or replace function public.set_platform_fee_rule(
  p_fee_type text,
  p_fee_value integer,
  p_actor_admin_id text
)
returns table (
  outcome text,
  fee_value jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_value jsonb;
  next_value jsonb;
begin
  if p_fee_type = 'percentage' then
    if p_fee_value < 0 or p_fee_value > 2500 then
      raise exception 'Percentage fee must be between 0 and 2500 basis points.';
    end if;
    next_value := jsonb_build_object(
      'type', 'percentage',
      'basis_points', p_fee_value
    );
  elsif p_fee_type = 'fixed' then
    if p_fee_value < 0 or p_fee_value > 10000000 then
      raise exception 'Fixed fee must be between 0 and 10000000 kobo per ticket.';
    end if;
    next_value := jsonb_build_object(
      'type', 'fixed',
      'fixed_kobo_per_ticket', p_fee_value
    );
  else
    raise exception 'Platform fee type is invalid.';
  end if;

  select setting.value into previous_value
  from public.platform_settings as setting
  where setting.key = 'platform_fee'
  for update;

  insert into public.platform_settings (key, value, updated_at)
  values ('platform_fee', next_value, now())
  on conflict (key) do update set
    value = excluded.value,
    updated_at = excluded.updated_at;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'admin.platform_fee_updated',
    'platform_settings',
    'platform_fee',
    jsonb_build_object(
      'actor_admin_id', p_actor_admin_id,
      'previous_rule', coalesce(previous_value, '{"type":"percentage","basis_points":500}'::jsonb),
      'new_rule', next_value
    )
  );

  return query select 'updated', next_value;
end;
$$;

revoke all on function public.set_platform_fee_rule(text, integer, text) from public;
grant execute on function public.set_platform_fee_rule(text, integer, text) to service_role;

create or replace function public.create_checkout_reservation_v2(
  p_customer_id uuid,
  p_event_id uuid,
  p_items jsonb,
  p_purchaser jsonb,
  p_checkout_token_hash text
)
returns table (
  order_id uuid,
  reference text,
  expires_at timestamptz,
  subtotal_kobo bigint,
  fee_kobo bigint,
  total_kobo bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_order record;
  stored_rule jsonb;
  basis_points integer := 500;
  fixed_kobo_per_ticket integer := 0;
  ticket_quantity integer := 0;
  calculated_fee bigint := 0;
begin
  select * into created_order
  from public.create_checkout_reservation(
    p_customer_id,
    p_event_id,
    p_items,
    0,
    p_purchaser,
    p_checkout_token_hash
  );

  select setting.value into stored_rule
  from public.platform_settings as setting
  where setting.key = 'platform_fee';

  select coalesce(sum((item.value ->> 'quantity')::integer), 0)::integer
  into ticket_quantity
  from jsonb_array_elements(p_items) as item(value);

  if stored_rule ->> 'type' = 'fixed'
    and jsonb_typeof(stored_rule -> 'fixed_kobo_per_ticket') = 'number'
    and (stored_rule ->> 'fixed_kobo_per_ticket')::integer between 0 and 10000000 then
    fixed_kobo_per_ticket := (stored_rule ->> 'fixed_kobo_per_ticket')::integer;
    calculated_fee := fixed_kobo_per_ticket::bigint * ticket_quantity;
  else
    if jsonb_typeof(stored_rule -> 'basis_points') = 'number'
      and (stored_rule ->> 'basis_points')::integer between 0 and 2500 then
      basis_points := (stored_rule ->> 'basis_points')::integer;
    elsif jsonb_typeof(stored_rule -> 'percentage') = 'number'
      and (stored_rule ->> 'percentage')::numeric between 0 and 25 then
      basis_points := round((stored_rule ->> 'percentage')::numeric * 100)::integer;
    end if;
    calculated_fee := round(created_order.subtotal_kobo * basis_points / 10000.0);
  end if;

  update public.orders as checkout_order
  set
    fee_kobo = calculated_fee,
    total_kobo = created_order.subtotal_kobo + calculated_fee,
    updated_at = now()
  where checkout_order.id = created_order.order_id;

  return query select
    created_order.order_id,
    created_order.reference,
    created_order.expires_at,
    created_order.subtotal_kobo,
    calculated_fee,
    created_order.subtotal_kobo + calculated_fee;
end;
$$;

revoke execute on function public.create_checkout_reservation(uuid, uuid, jsonb, integer, jsonb, text) from service_role;
revoke all on function public.create_checkout_reservation_v2(uuid, uuid, jsonb, jsonb, text) from public;
grant execute on function public.create_checkout_reservation_v2(uuid, uuid, jsonb, jsonb, text) to service_role;

comment on function public.set_platform_fee_rule(text, integer, text)
is 'Validates and records the active percentage or fixed-per-ticket platform fee with an administrator audit event.';

comment on function public.create_checkout_reservation_v2(uuid, uuid, jsonb, jsonb, text)
is 'Creates a reservation and calculates its service fee only from the current database platform setting.';
