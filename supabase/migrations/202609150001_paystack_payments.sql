-- Phase 3: production Paystack initialization, verification and ticket issuance.
-- Payment values are always matched against the server-owned order total.

alter table public.orders
  alter column customer_id drop not null,
  add column if not exists purchaser_name text,
  add column if not exists purchaser_email text,
  add column if not exists purchaser_phone text,
  add column if not exists checkout_token_hash text;

update public.orders as checkout_order
set
  purchaser_name = coalesce(
    nullif(profile.full_name, ''),
    checkout_order.purchaser_name,
    'Naija Tickets guest'
  ),
  purchaser_email = coalesce(
    checkout_order.purchaser_email,
    'legacy+' || checkout_order.id::text || '@naijatickets.invalid'
  ),
  purchaser_phone = coalesce(checkout_order.purchaser_phone, 'Not provided'),
  checkout_token_hash = coalesce(
    checkout_order.checkout_token_hash,
    encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex')
  )
from public.profiles as profile
where profile.id = checkout_order.customer_id;

update public.orders as checkout_order
set
  purchaser_name = coalesce(checkout_order.purchaser_name, 'Naija Tickets guest'),
  purchaser_email = coalesce(
    checkout_order.purchaser_email,
    'legacy+' || checkout_order.id::text || '@naijatickets.invalid'
  ),
  purchaser_phone = coalesce(checkout_order.purchaser_phone, 'Not provided'),
  checkout_token_hash = coalesce(
    checkout_order.checkout_token_hash,
    encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex')
  )
where checkout_order.purchaser_name is null
  or checkout_order.purchaser_email is null
  or checkout_order.purchaser_phone is null
  or checkout_order.checkout_token_hash is null;

alter table public.orders
  alter column purchaser_name set not null,
  alter column purchaser_email set not null,
  alter column purchaser_phone set not null,
  alter column checkout_token_hash set not null,
  add constraint orders_purchaser_name_valid check (char_length(trim(purchaser_name)) between 2 and 120),
  add constraint orders_purchaser_email_valid check (purchaser_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  add constraint orders_purchaser_phone_valid check (char_length(trim(purchaser_phone)) between 7 and 40),
  add constraint orders_checkout_token_hash_valid check (checkout_token_hash ~ '^[a-f0-9]{64}$');

alter table public.payments
  add column if not exists currency char(3) not null default 'NGN',
  add column if not exists provider_transaction_id text,
  add column if not exists provider_status text,
  add column if not exists authorization_url text,
  add column if not exists access_code text,
  add column if not exists initialization_response jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.tickets
  add column if not exists attendee_index integer;

create table if not exists public.ticket_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ticket_deliveries enable row level security;

with numbered_tickets as (
  select
    id,
    row_number() over (partition by order_item_id order by issued_at, id) - 1 as attendee_index
  from public.tickets
  where attendee_index is null
)
update public.tickets as ticket
set attendee_index = numbered_tickets.attendee_index
from numbered_tickets
where ticket.id = numbered_tickets.id;

alter table public.tickets
  alter column attendee_index set not null;

create unique index if not exists tickets_order_item_attendee_idx
  on public.tickets (order_item_id, attendee_index);

create index if not exists payments_order_created_idx
  on public.payments (order_id, created_at desc);

create unique index if not exists payments_paystack_transaction_idx
  on public.payments (provider_transaction_id)
  where provider = 'paystack' and provider_transaction_id is not null;

with ranked_open_payments as (
  select
    id,
    row_number() over (partition by order_id order by created_at desc, id desc) as attempt_number
  from public.payments
  where provider = 'paystack' and status in ('initialized', 'pending')
)
update public.payments as payment
set status = 'abandoned', updated_at = now()
from ranked_open_payments
where payment.id = ranked_open_payments.id
  and ranked_open_payments.attempt_number > 1;

create unique index if not exists payments_open_paystack_order_idx
  on public.payments (order_id)
  where provider = 'paystack' and status in ('initialized', 'pending');

create unique index if not exists orders_checkout_token_hash_idx
  on public.orders (checkout_token_hash);

drop function if exists public.create_checkout_reservation(uuid, uuid, jsonb, integer);

create function public.create_checkout_reservation(
  p_customer_id uuid,
  p_event_id uuid,
  p_items jsonb,
  p_fee_basis_points integer,
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
  new_order public.orders%rowtype;
  item jsonb;
  ticket public.ticket_types%rowtype;
  item_quantity integer;
  attendee_data jsonb;
  new_order_item_id uuid;
  running_subtotal bigint := 0;
  calculated_fee bigint := 0;
  held_until timestamptz := now() + interval '10 minutes';
  seen_ticket_ids uuid[] := array[]::uuid[];
  expired_reservation record;
begin
  if p_fee_basis_points < 0 or p_fee_basis_points > 2500 then
    raise exception 'The configured service fee is invalid.';
  end if;

  if p_customer_id is not null
    and not exists (select 1 from public.profiles where id = p_customer_id) then
    raise exception 'Customer account is not available.';
  end if;

  if p_purchaser is null
    or jsonb_typeof(p_purchaser) <> 'object'
    or char_length(trim(coalesce(p_purchaser ->> 'name', ''))) not between 2 and 120
    or coalesce(p_purchaser ->> 'email', '') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(trim(coalesce(p_purchaser ->> 'phone', ''))) not between 7 and 40 then
    raise exception 'Purchaser details are invalid.';
  end if;

  if p_checkout_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Checkout token is invalid.';
  end if;

  if not exists (
    select 1 from public.events
    where id = p_event_id and status = 'published'
  ) then
    raise exception 'This event is not available for checkout.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one ticket.';
  end if;

  for expired_reservation in
    select
      reservation.id,
      reservation.ticket_type_id,
      reservation.quantity,
      order_item.order_id
    from public.reservations as reservation
    join public.order_items as order_item on order_item.id = reservation.order_item_id
    where reservation.expires_at <= now()
      and reservation.released_at is null
      and reservation.converted_at is null
    for update of reservation
  loop
    update public.ticket_types
    set quantity_reserved = greatest(0, quantity_reserved - expired_reservation.quantity)
    where id = expired_reservation.ticket_type_id;

    update public.reservations
    set released_at = now()
    where id = expired_reservation.id;

    update public.orders
    set status = 'expired', updated_at = now()
    where id = expired_reservation.order_id and status = 'pending';
  end loop;

  insert into public.orders (
    customer_id,
    event_id,
    status,
    reservation_expires_at,
    purchaser_name,
    purchaser_email,
    purchaser_phone,
    checkout_token_hash
  ) values (
    p_customer_id,
    p_event_id,
    'pending',
    held_until,
    trim(p_purchaser ->> 'name'),
    lower(trim(p_purchaser ->> 'email')),
    trim(p_purchaser ->> 'phone'),
    p_checkout_token_hash
  ) returning * into new_order;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item ->> 'quantity')::integer;
    attendee_data := coalesce(item -> 'attendees', '[]'::jsonb);

    select * into ticket
    from public.ticket_types
    where id = (item ->> 'ticket_type_id')::uuid
    for update;

    if not found or ticket.event_id <> p_event_id or not ticket.active then
      raise exception 'A selected ticket is not available.';
    end if;
    if ticket.id = any(seen_ticket_ids) then
      raise exception 'A ticket type was selected more than once.';
    end if;
    seen_ticket_ids := array_append(seen_ticket_ids, ticket.id);

    if item_quantity < ticket.min_per_order or item_quantity > ticket.max_per_order then
      raise exception 'A selected ticket quantity is outside its order limit.';
    end if;
    if jsonb_typeof(attendee_data) <> 'array'
      or jsonb_array_length(attendee_data) <> item_quantity then
      raise exception 'Attendee details are incomplete.';
    end if;
    if ticket.sales_start_at is not null and ticket.sales_start_at > now() then
      raise exception 'Ticket sales have not started.';
    end if;
    if ticket.sales_end_at is not null and ticket.sales_end_at <= now() then
      raise exception 'Ticket sales have closed.';
    end if;
    if ticket.quantity_total - ticket.quantity_sold - ticket.quantity_reserved < item_quantity then
      raise exception 'The requested ticket quantity exceeds current availability.';
    end if;

    insert into public.order_items (
      order_id,
      ticket_type_id,
      quantity,
      unit_price_kobo,
      line_total_kobo,
      attendee_data
    ) values (
      new_order.id,
      ticket.id,
      item_quantity,
      ticket.price_kobo,
      ticket.price_kobo * item_quantity,
      attendee_data
    ) returning id into new_order_item_id;

    update public.ticket_types
    set quantity_reserved = quantity_reserved + item_quantity
    where id = ticket.id;

    insert into public.reservations (
      order_item_id,
      ticket_type_id,
      quantity,
      expires_at
    ) values (
      new_order_item_id,
      ticket.id,
      item_quantity,
      held_until
    );

    running_subtotal := running_subtotal + (ticket.price_kobo * item_quantity);
  end loop;

  if running_subtotal > 0 then
    calculated_fee := round(running_subtotal * p_fee_basis_points / 10000.0);
  end if;

  update public.orders
  set
    subtotal_kobo = running_subtotal,
    fee_kobo = calculated_fee,
    total_kobo = running_subtotal + calculated_fee,
    updated_at = now()
  where id = new_order.id;

  return query
  select
    new_order.id,
    new_order.reference,
    held_until,
    running_subtotal,
    calculated_fee,
    running_subtotal + calculated_fee;
end;
$$;

revoke all on function public.create_checkout_reservation(uuid, uuid, jsonb, integer, jsonb, text) from public;
grant execute on function public.create_checkout_reservation(uuid, uuid, jsonb, integer, jsonb, text) to service_role;

create or replace function public.release_checkout_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  held record;
begin
  for held in
    select reservation.id, reservation.ticket_type_id, reservation.quantity
    from public.reservations as reservation
    join public.order_items as order_item on order_item.id = reservation.order_item_id
    where order_item.order_id = p_order_id
      and reservation.released_at is null
      and reservation.converted_at is null
    for update of reservation
  loop
    update public.ticket_types
    set quantity_reserved = greatest(0, quantity_reserved - held.quantity)
    where id = held.ticket_type_id;

    update public.reservations
    set released_at = now()
    where id = held.id;
  end loop;

  update public.orders
  set status = 'expired', updated_at = now()
  where id = p_order_id and status = 'pending';
end;
$$;

revoke all on function public.release_checkout_order(uuid) from public;
grant execute on function public.release_checkout_order(uuid) to service_role;

create or replace function public.issue_checkout_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype;
  item record;
  attendee record;
  issued_count integer := 0;
begin
  select * into locked_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order was not found.';
  end if;

  for item in
    select
      order_item.id,
      order_item.ticket_type_id,
      order_item.quantity,
      order_item.attendee_data,
      reservation.id as reservation_id
    from public.order_items as order_item
    join public.reservations as reservation on reservation.order_item_id = order_item.id
    where order_item.order_id = p_order_id
      and reservation.released_at is null
      and reservation.converted_at is null
    order by order_item.id
    for update of order_item, reservation
  loop
    update public.ticket_types
    set
      quantity_reserved = quantity_reserved - item.quantity,
      quantity_sold = quantity_sold + item.quantity
    where id = item.ticket_type_id
      and quantity_reserved >= item.quantity
      and quantity_sold + item.quantity <= quantity_total;

    if not found then
      raise exception 'Reserved inventory is no longer available.';
    end if;

    update public.reservations
    set converted_at = now()
    where id = item.reservation_id;

    for attendee in
      select value, ordinality - 1 as attendee_index
      from jsonb_array_elements(item.attendee_data) with ordinality
    loop
      insert into public.tickets (
        order_item_id,
        event_id,
        attendee_index,
        attendee_name,
        attendee_email,
        qr_token_hash,
        display_code
      ) values (
        item.id,
        locked_order.event_id,
        attendee.attendee_index,
        attendee.value ->> 'name',
        lower(attendee.value ->> 'email'),
        encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'),
        'NT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
      )
      on conflict (order_item_id, attendee_index) do nothing;
    end loop;
  end loop;

  select count(*)::integer into issued_count
  from public.tickets as ticket
  join public.order_items as order_item on order_item.id = ticket.order_item_id
  where order_item.order_id = p_order_id;

  return issued_count;
end;
$$;

revoke all on function public.issue_checkout_tickets(uuid) from public;
grant execute on function public.issue_checkout_tickets(uuid) to service_role;

create or replace function public.prepare_paystack_payment(
  p_order_id uuid,
  p_checkout_token_hash text
)
returns table (
  outcome text,
  order_id uuid,
  order_reference text,
  payment_reference text,
  amount_kobo bigint,
  currency text,
  expires_at timestamptz,
  authorization_url text,
  purchaser_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype;
  existing_payment public.payments%rowtype;
begin
  select * into locked_order
  from public.orders
  where id = p_order_id and checkout_token_hash = p_checkout_token_hash
  for update;

  if not found then
    return query select 'not_found', null::uuid, null::text, null::text, null::bigint, null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  if locked_order.status = 'paid' then
    return query select 'already_paid', locked_order.id, locked_order.reference, null::text, locked_order.total_kobo, locked_order.currency::text, locked_order.reservation_expires_at, null::text, locked_order.purchaser_email;
    return;
  end if;

  if locked_order.status <> 'pending' then
    return query select locked_order.status::text, locked_order.id, locked_order.reference, null::text, locked_order.total_kobo, locked_order.currency::text, locked_order.reservation_expires_at, null::text, locked_order.purchaser_email;
    return;
  end if;

  if locked_order.reservation_expires_at is null or locked_order.reservation_expires_at <= now() then
    perform public.release_checkout_order(locked_order.id);
    return query select 'expired', locked_order.id, locked_order.reference, null::text, locked_order.total_kobo, locked_order.currency::text, locked_order.reservation_expires_at, null::text, locked_order.purchaser_email;
    return;
  end if;

  if locked_order.total_kobo = 0 then
    return query select 'free', locked_order.id, locked_order.reference, null::text, 0::bigint, locked_order.currency::text, locked_order.reservation_expires_at, null::text, locked_order.purchaser_email;
    return;
  end if;

  select * into existing_payment
  from public.payments
  where public.payments.order_id = locked_order.id
    and provider = 'paystack'
    and status in ('initialized', 'pending')
  order by created_at desc
  limit 1
  for update;

  if not found then
    insert into public.payments (
      order_id,
      provider,
      provider_reference,
      status,
      amount_kobo,
      currency
    ) values (
      locked_order.id,
      'paystack',
      'NT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)),
      'initialized',
      locked_order.total_kobo,
      locked_order.currency
    )
    returning * into existing_payment;
  end if;

  return query
  select
    'ready',
    locked_order.id,
    locked_order.reference,
    existing_payment.provider_reference,
    locked_order.total_kobo,
    locked_order.currency::text,
    locked_order.reservation_expires_at,
    existing_payment.authorization_url,
    locked_order.purchaser_email;
end;
$$;

revoke all on function public.prepare_paystack_payment(uuid, text) from public;
grant execute on function public.prepare_paystack_payment(uuid, text) to service_role;

create or replace function public.complete_free_checkout(
  p_order_id uuid,
  p_checkout_token_hash text
)
returns table (outcome text, order_reference text, ticket_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype;
  issued_count integer;
begin
  select * into locked_order
  from public.orders
  where id = p_order_id and checkout_token_hash = p_checkout_token_hash
  for update;

  if not found then
    return query select 'not_found', null::text, 0;
    return;
  end if;

  if locked_order.status = 'paid' then
    select count(*)::integer into issued_count
    from public.tickets as ticket
    join public.order_items as order_item on order_item.id = ticket.order_item_id
    where order_item.order_id = locked_order.id;
    return query select 'already_paid', locked_order.reference, issued_count;
    return;
  end if;

  if locked_order.status <> 'pending' or locked_order.total_kobo <> 0 then
    return query select 'not_payable', locked_order.reference, 0;
    return;
  end if;

  if locked_order.reservation_expires_at is null or locked_order.reservation_expires_at <= now() then
    perform public.release_checkout_order(locked_order.id);
    return query select 'expired', locked_order.reference, 0;
    return;
  end if;

  issued_count := public.issue_checkout_tickets(locked_order.id);

  insert into public.payments (
    order_id,
    provider,
    provider_reference,
    status,
    amount_kobo,
    currency,
    provider_status,
    verified_at
  ) values (
    locked_order.id,
    'demo_free',
    'FREE-' || locked_order.reference,
    'verified',
    0,
    locked_order.currency,
    'success',
    now()
  )
  on conflict (provider, provider_reference) do nothing;

  update public.orders
  set status = 'paid', paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = locked_order.id and status = 'pending';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    locked_order.customer_id,
    'checkout.completed_free',
    'order',
    locked_order.id::text,
    jsonb_build_object('ticket_count', issued_count)
  );

  return query select 'success', locked_order.reference, issued_count;
end;
$$;

revoke all on function public.complete_free_checkout(uuid, text) from public;
grant execute on function public.complete_free_checkout(uuid, text) to service_role;

create or replace function public.finalize_paystack_payment(
  p_provider_reference text,
  p_provider_status text,
  p_amount_kobo bigint,
  p_currency text,
  p_provider_transaction_id text,
  p_payload jsonb,
  p_provider_event_id text default null,
  p_event_type text default null,
  p_payload_hash text default null
)
returns table (
  outcome text,
  order_id uuid,
  order_reference text,
  ticket_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_payment public.payments%rowtype;
  locked_order public.orders%rowtype;
  issued_count integer := 0;
  inserted_event_id uuid;
begin
  select * into locked_payment
  from public.payments
  where provider = 'paystack' and provider_reference = p_provider_reference
  for update;

  if not found then
    return query select 'unknown_reference', null::uuid, null::text, 0;
    return;
  end if;

  select * into locked_order
  from public.orders
  where id = locked_payment.order_id
  for update;

  if p_provider_event_id is not null then
    insert into public.webhook_events (
      provider,
      event_id,
      event_type,
      payload_hash
    ) values (
      'paystack',
      p_provider_event_id,
      coalesce(p_event_type, 'charge.success'),
      coalesce(p_payload_hash, '')
    )
    on conflict (provider, event_id) do nothing
    returning id into inserted_event_id;

    if inserted_event_id is null then
      select count(*)::integer into issued_count
      from public.tickets as ticket
      join public.order_items as order_item on order_item.id = ticket.order_item_id
      where order_item.order_id = locked_order.id;
      return query select 'duplicate_event', locked_order.id, locked_order.reference, issued_count;
      return;
    end if;
  end if;

  if p_provider_status <> 'success' then
    update public.payments
    set
      status = case
        when p_provider_status = 'failed' then 'failed'::public.payment_status
        when p_provider_status = 'abandoned' then 'abandoned'::public.payment_status
        else 'pending'::public.payment_status
      end,
      provider_status = p_provider_status,
      provider_transaction_id = p_provider_transaction_id,
      raw_verification = p_payload,
      updated_at = now()
    where id = locked_payment.id;

    if inserted_event_id is not null then
      update public.webhook_events set processed_at = now() where id = inserted_event_id;
    end if;
    return query select 'not_successful', locked_order.id, locked_order.reference, 0;
    return;
  end if;

  if p_amount_kobo <> locked_payment.amount_kobo
    or p_amount_kobo <> locked_order.total_kobo
    or upper(p_currency) <> locked_payment.currency
    or upper(p_currency) <> locked_order.currency then
    update public.payments
    set
      status = 'failed',
      provider_status = 'amount_or_currency_mismatch',
      provider_transaction_id = p_provider_transaction_id,
      raw_verification = p_payload,
      updated_at = now()
    where id = locked_payment.id;

    if inserted_event_id is not null then
      update public.webhook_events set processed_at = now() where id = inserted_event_id;
    end if;
    return query select 'amount_or_currency_mismatch', locked_order.id, locked_order.reference, 0;
    return;
  end if;

  update public.payments
  set
    status = 'verified',
    provider_status = p_provider_status,
    provider_transaction_id = p_provider_transaction_id,
    raw_verification = p_payload,
    verified_at = coalesce(verified_at, now()),
    updated_at = now()
  where id = locked_payment.id;

  if locked_order.status = 'paid' then
    select count(*)::integer into issued_count
    from public.tickets as ticket
    join public.order_items as order_item on order_item.id = ticket.order_item_id
    where order_item.order_id = locked_order.id;
    if inserted_event_id is not null then
      update public.webhook_events set processed_at = now() where id = inserted_event_id;
    end if;
    return query select 'already_paid', locked_order.id, locked_order.reference, issued_count;
    return;
  end if;

  if locked_order.status <> 'pending' then
    if inserted_event_id is not null then
      update public.webhook_events set processed_at = now() where id = inserted_event_id;
    end if;
    return query select 'order_not_payable', locked_order.id, locked_order.reference, 0;
    return;
  end if;

  if locked_order.reservation_expires_at is null
    or locked_order.reservation_expires_at <= now()
    or exists (
      select 1
      from public.reservations as reservation
      join public.order_items as order_item on order_item.id = reservation.order_item_id
      where order_item.order_id = locked_order.id
        and (
          reservation.released_at is not null
          or reservation.converted_at is not null
          or reservation.expires_at <= now()
        )
    ) then
    perform public.release_checkout_order(locked_order.id);
    if inserted_event_id is not null then
      update public.webhook_events set processed_at = now() where id = inserted_event_id;
    end if;
    return query select 'reservation_expired', locked_order.id, locked_order.reference, 0;
    return;
  end if;

  issued_count := public.issue_checkout_tickets(locked_order.id);

  update public.orders
  set status = 'paid', paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = locked_order.id and status = 'pending';

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'payment.verified',
    'order',
    locked_order.id::text,
    jsonb_build_object(
      'provider', 'paystack',
      'provider_reference', p_provider_reference,
      'ticket_count', issued_count
    )
  );

  if inserted_event_id is not null then
    update public.webhook_events set processed_at = now() where id = inserted_event_id;
  end if;

  return query select 'success', locked_order.id, locked_order.reference, issued_count;
end;
$$;

revoke all on function public.finalize_paystack_payment(text, text, bigint, text, text, jsonb, text, text, text) from public;
grant execute on function public.finalize_paystack_payment(text, text, bigint, text, text, jsonb, text, text, text) to service_role;

create or replace function public.claim_ticket_delivery(p_order_id uuid)
returns table (
  outcome text,
  delivery_id uuid,
  recipient_email text,
  order_reference text,
  event_title text,
  event_date timestamptz,
  event_venue text,
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
    return query select 'not_ready', null::uuid, null::text, null::text, null::text, null::timestamptz, null::text, '[]'::jsonb;
    return;
  end if;

  select * into selected_event from public.events where id = locked_order.event_id;
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
    return query select 'already_sent', delivery.id, delivery.recipient_email, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, ticket_payload;
    return;
  end if;

  if delivery.status = 'processing'
    and delivery.claimed_at > now() - interval '30 minutes' then
    return query select 'in_progress', delivery.id, delivery.recipient_email, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, ticket_payload;
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

  return query select 'send', delivery.id, delivery.recipient_email, locked_order.reference, selected_event.title, selected_event.starts_at, selected_event.venue_name, ticket_payload;
end;
$$;

revoke all on function public.claim_ticket_delivery(uuid) from public;
grant execute on function public.claim_ticket_delivery(uuid) to service_role;

create or replace function public.complete_ticket_delivery(
  p_delivery_id uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ticket_deliveries
  set
    status = case when p_success then 'sent' else 'failed' end,
    provider_message_id = case when p_success then p_provider_message_id else provider_message_id end,
    last_error = case when p_success then null else left(coalesce(p_error, 'Unknown delivery error'), 500) end,
    sent_at = case when p_success then coalesce(sent_at, now()) else sent_at end,
    updated_at = now()
  where id = p_delivery_id
    and status = 'processing';
end;
$$;

revoke all on function public.complete_ticket_delivery(uuid, boolean, text, text) from public;
grant execute on function public.complete_ticket_delivery(uuid, boolean, text, text) to service_role;

comment on function public.prepare_paystack_payment(uuid, text)
is 'Validates a guest checkout token, locks its order and creates or reuses one open server-owned Paystack attempt.';

comment on function public.finalize_paystack_payment(text, text, bigint, text, text, jsonb, text, text, text)
is 'Idempotently verifies an expected Paystack payment, converts held inventory and issues tickets once.';

comment on function public.claim_ticket_delivery(uuid)
is 'Claims one retryable ticket confirmation email for a paid order.';
