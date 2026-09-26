-- Keep previously issued group tickets and pending orders unchanged. Only new
-- group reservations use claims. Capacity remains in individual admission units.
alter table public.order_items add column group_claim_required boolean not null default false;
create table public.group_bookings (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references public.order_items(id),
  admissions integer not null check(admissions between 2 and 400),
  invite_token text not null unique default encode(extensions.gen_random_bytes(32),'hex'),
  created_at timestamptz not null default now()
);
alter table public.group_bookings enable row level security;
revoke all on public.group_bookings from anon, authenticated;
grant all on public.group_bookings to service_role;

alter table public.tickets
  alter column attendee_name drop not null,
  alter column attendee_email drop not null,
  alter column qr_token_hash drop not null,
  alter column display_code drop not null,
  add column group_booking_id uuid references public.group_bookings(id),
  add column attendee_phone text,
  add column claim_state text not null default 'CLAIMED' check(claim_state in ('UNCLAIMED','CLAIMED','CHECKED_IN')),
  add column claimed_at timestamptz,
  add column claim_access_token text unique,
  add column claim_email_key text,
  add column claim_phone_key text,
  add constraint tickets_claim_qr_state check (
    (claim_state='UNCLAIMED' and group_booking_id is not null and attendee_name is null
      and attendee_email is null and qr_token_hash is null and display_code is null)
    or (claim_state<>'UNCLAIMED' and attendee_name is not null and attendee_email is not null
      and qr_token_hash is not null and display_code is not null)
  );
update public.tickets set claim_state='CHECKED_IN' where status='used';
create unique index tickets_group_email on public.tickets(group_booking_id,claim_email_key) where claim_email_key is not null;
create unique index tickets_group_phone on public.tickets(group_booking_id,claim_phone_key) where claim_phone_key is not null;
create index tickets_group_slots on public.tickets(group_booking_id,attendee_index);

-- Existing entry/refund routines keep their status semantics. A single QR still
-- admits one person, and unclaimed records have no code that can be scanned.
create function public.sync_ticket_claim_entry() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='used' then new.claim_state:='CHECKED_IN'; end if;
  return new;
end; $$;
create trigger tickets_claim_entry before update of status on public.tickets
for each row execute function public.sync_ticket_claim_entry();
revoke all on function public.sync_ticket_claim_entry() from public,anon,authenticated;

create or replace function public.create_checkout_reservation(
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
  admission_quantity integer;
  total_admissions integer := 0;
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
    where id = p_event_id and status = 'published' and ends_at > now()
  ) then
    raise exception 'This event is not available for checkout.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
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
    admission_quantity := item_quantity * ticket.admissions_per_ticket;
    total_admissions := total_admissions + admission_quantity;
    if total_admissions > 400 then
      raise exception 'Choose no more than 400 admissions per checkout.';
    end if;
    if jsonb_typeof(attendee_data) <> 'array'
      or (ticket.admissions_per_ticket = 1 and jsonb_array_length(attendee_data) <> admission_quantity)
      or (ticket.admissions_per_ticket > 1 and jsonb_array_length(attendee_data) <> 0) then
      raise exception 'Attendee details are incomplete.';
    end if;
    if ticket.sales_start_at is not null and ticket.sales_start_at > now() then
      raise exception 'Ticket sales have not started.';
    end if;
    if ticket.sales_end_at is not null and ticket.sales_end_at <= now() then
      raise exception 'Ticket sales have closed.';
    end if;
    if ticket.quantity_total - ticket.quantity_sold - ticket.quantity_reserved < admission_quantity then
      raise exception 'The requested ticket quantity exceeds current availability.';
    end if;

    insert into public.order_items (
      order_id,
      ticket_type_id,
      quantity,
      admissions_per_ticket,
      unit_price_kobo,
      line_total_kobo,
      attendee_data,
      group_claim_required
    ) values (
      new_order.id,
      ticket.id,
      item_quantity,
      ticket.admissions_per_ticket,
      ticket.price_kobo,
      ticket.price_kobo * item_quantity,
      attendee_data,
      ticket.admissions_per_ticket > 1
    ) returning id into new_order_item_id;

    update public.ticket_types
    set quantity_reserved = quantity_reserved + admission_quantity
    where id = ticket.id;

    insert into public.reservations (
      order_item_id,
      ticket_type_id,
      quantity,
      expires_at
    ) values (
      new_order_item_id,
      ticket.id,
      admission_quantity,
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
  booking_id uuid;
  slot_index integer;
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
      order_item.quantity * order_item.admissions_per_ticket as quantity,
      reservation.quantity as reserved_admissions,
      order_item.attendee_data,
      order_item.group_claim_required,
      reservation.id as reservation_id
    from public.order_items as order_item
    join public.reservations as reservation on reservation.order_item_id = order_item.id
    where order_item.order_id = p_order_id
      and reservation.released_at is null
      and reservation.converted_at is null
    order by order_item.id
    for update of order_item, reservation
  loop
    if item.reserved_admissions <> item.quantity or (not item.group_claim_required and jsonb_array_length(item.attendee_data) <> item.quantity) then
      raise exception 'Reserved group admissions do not match attendee details.';
    end if;
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

    if item.group_claim_required then
      insert into public.group_bookings(order_item_id,admissions)
        values(item.id,item.quantity) on conflict(order_item_id) do nothing;
      select id into booking_id from public.group_bookings where order_item_id=item.id;
      for slot_index in 0..(item.quantity - 1) loop
        insert into public.tickets(order_item_id,event_id,attendee_index,group_booking_id,claim_state)
          values(item.id,locked_order.event_id,slot_index,booking_id,'UNCLAIMED')
          on conflict(order_item_id,attendee_index) do nothing;
      end loop;
    else
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
    end if;
  end loop;

  select count(*)::integer into issued_count
  from public.tickets as ticket
  join public.order_items as order_item on order_item.id = ticket.order_item_id
  where order_item.order_id = p_order_id;

  return issued_count;
end;
$$;


-- Service-only RPC called by the public claim API. Lock order before booking to
-- coordinate refunds, then serialise claims including duplicate identity checks.
create function public.claim_group_ticket(p_invite_token text,p_name text,p_email text,p_phone text)
returns text language plpgsql security definer set search_path='' as $$
declare
  booking public.group_bookings%rowtype;
  order_row public.orders%rowtype;
  event_row public.events%rowtype;
  order_id uuid;
  slot_id uuid;
  email_key text:=lower(trim(p_email));
  phone_key text:=regexp_replace(trim(p_phone),'[^0-9]','','g');
  access_token text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120
    or char_length(coalesce(email_key,'')) > 254
    or coalesce(email_key,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(coalesce(phone_key,'')) not between 7 and 15
    or char_length(coalesce(p_phone,'')) > 40 then
    raise exception 'Enter a valid name, email and phone number.';
  end if;
  -- Normalise Nigerian local and international numbers to the same identity.
  if phone_key like '00234%' then phone_key:=substring(phone_key from 3); end if;
  if phone_key ~ '^0[0-9]{10}$' then phone_key:='234'||substring(phone_key from 2); end if;
  select i.order_id into order_id from public.group_bookings g
    join public.order_items i on i.id=g.order_item_id where g.invite_token=p_invite_token;
  if order_id is null then raise exception 'This group invitation is unavailable.'; end if;
  select * into order_row from public.orders where id=order_id for share;
  select * into booking from public.group_bookings where invite_token=p_invite_token for update;
  select * into event_row from public.events where id=order_row.event_id for share;
  if order_row.status not in ('paid','partially_refunded') or not exists (
    select 1 from public.payments where payments.order_id=order_row.id and status='verified'
  ) or event_row.status<>'published' or event_row.ends_at<=now() then
    raise exception 'This group invitation is unavailable.';
  end if;
  if exists(select 1 from public.tickets where group_booking_id=booking.id
    and (claim_email_key=email_key or claim_phone_key=phone_key)) then
    raise exception 'This email or phone number has already claimed a ticket in this group.';
  end if;
  select id into slot_id from public.tickets where group_booking_id=booking.id
    and claim_state='UNCLAIMED' and status='valid' order by attendee_index limit 1 for update;
  if slot_id is null then raise exception 'All tickets in this group have been claimed.'; end if;
  update public.tickets set attendee_name=trim(p_name),attendee_email=email_key,
    attendee_phone=trim(p_phone),claim_email_key=email_key,claim_phone_key=phone_key,
    claim_state='CLAIMED',claimed_at=now(),claim_access_token=access_token,
    qr_token_hash=encode(extensions.digest(gen_random_uuid()::text||clock_timestamp()::text,'sha256'),'hex'),
    display_code='NT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))
    where id=slot_id;
  return access_token;
end; $$;
revoke all on function public.claim_group_ticket(text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_group_ticket(text,text,text,text) to service_role;
