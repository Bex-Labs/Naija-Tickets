-- Packages retain the existing order price/quantity semantics. Inventory and
-- reservation counters are admission units; ordinary tickets default to one.
alter table public.ticket_types
  add column admissions_per_ticket integer not null default 1
    check (admissions_per_ticket between 1 and 100),
  add constraint ticket_types_whole_packages check (quantity_total % admissions_per_ticket = 0);
alter table public.order_items
  add column admissions_per_ticket integer not null default 1
    check (admissions_per_ticket between 1 and 100);

comment on column public.ticket_types.quantity_total is 'Admission capacity: package quantity multiplied by admissions_per_ticket.';
comment on column public.order_items.quantity is 'Purchased packages. Multiply by the admission snapshot for the individual ticket count.';
comment on column public.reservations.quantity is 'Reserved individual admissions, including every member of a group package.';

-- Freeze group size once an order exists so pending, paid and historical orders
-- cannot be reinterpreted by edits. The order item also keeps its own snapshot.
create function public.protect_ticket_admission_size()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.admissions_per_ticket <> new.admissions_per_ticket and exists (
    select 1 from public.order_items where ticket_type_id = old.id
  ) then
    raise exception 'The number admitted cannot change after a ticket has been ordered. Create a new ticket type.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_ticket_admission_size() from public, anon, authenticated;
create trigger ticket_types_protect_admission_size
before update of admissions_per_ticket on public.ticket_types
for each row execute function public.protect_ticket_admission_size();

create or replace function public.save_organiser_event(
  p_user_id uuid,
  p_event_id uuid,
  p_organiser_id uuid,
  p_category_id uuid,
  p_title text,
  p_presenter_line text,
  p_description text,
  p_venue_name text,
  p_address text,
  p_directions_url text,
  p_city text,
  p_state text,
  p_timezone text,
  p_timezone_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_sales_start_at timestamptz,
  p_sales_end_at timestamptz,
  p_status public.event_status,
  p_image_path text,
  p_organiser_name text,
  p_organiser_description text,
  p_schedule jsonb,
  p_policies jsonb,
  p_ticket_types jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_event_id uuid;
  schedule_item jsonb;
  policy_item jsonb;
  ticket_item jsonb;
  locked_ticket public.ticket_types%rowtype;
  ticket_id uuid;
  kept_ticket_ids uuid[] := array[]::uuid[];
  ticket_total integer;
  ticket_admissions integer;
  ticket_min integer;
  ticket_max integer;
  ticket_price bigint;
  ticket_active boolean;
  ticket_sales_start timestamptz;
  ticket_sales_end timestamptz;
begin
  if not exists (
    select 1 from public.organiser_memberships
    where organiser_id = p_organiser_id and user_id = p_user_id
  ) then
    raise exception 'Organiser membership is required.';
  end if;

  if p_status not in ('draft', 'submitted') then
    raise exception 'The event status is invalid.';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The event end must be after its start.';
  end if;
  if p_sales_start_at is not null and p_sales_end_at is not null
    and p_sales_end_at <= p_sales_start_at then
    raise exception 'The sales end must be after its start.';
  end if;
  if coalesce(jsonb_typeof(p_schedule), 'null') <> 'array' or jsonb_array_length(p_schedule) > 30
    or coalesce(jsonb_typeof(p_policies), 'null') <> 'array' or jsonb_array_length(p_policies) > 30
    or coalesce(jsonb_typeof(p_ticket_types), 'null') <> 'array' or jsonb_array_length(p_ticket_types) = 0
    or jsonb_array_length(p_ticket_types) > 20 then
    raise exception 'The structured event details are invalid.';
  end if;

  update public.organisers
  set
    name = trim(p_organiser_name),
    description = nullif(trim(p_organiser_description), '')
  where id = p_organiser_id;

  if p_event_id is null then
    insert into public.events (
      organiser_id,
      category_id,
      title,
      slug,
      presenter_line,
      description,
      venue_name,
      address,
      directions_url,
      city,
      state,
      timezone,
      timezone_label,
      starts_at,
      ends_at,
      sales_start_at,
      sales_end_at,
      status,
      image_path
    ) values (
      p_organiser_id,
      p_category_id,
      trim(p_title),
      regexp_replace(lower(trim(p_title)), '[^a-z0-9]+', '-', 'g') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      trim(p_presenter_line),
      trim(p_description),
      trim(p_venue_name),
      trim(p_address),
      nullif(trim(p_directions_url), ''),
      trim(p_city),
      trim(p_state),
      p_timezone,
      upper(trim(p_timezone_label)),
      p_starts_at,
      p_ends_at,
      p_sales_start_at,
      p_sales_end_at,
      p_status,
      nullif(trim(p_image_path), '')
    ) returning id into saved_event_id;
  else
    select id into saved_event_id
    from public.events
    where id = p_event_id and organiser_id = p_organiser_id
    for update;

    if not found then
      raise exception 'Event not found.';
    end if;

    update public.events
    set
      category_id = p_category_id,
      title = trim(p_title),
      presenter_line = trim(p_presenter_line),
      description = trim(p_description),
      venue_name = trim(p_venue_name),
      address = trim(p_address),
      directions_url = nullif(trim(p_directions_url), ''),
      city = trim(p_city),
      state = trim(p_state),
      timezone = p_timezone,
      timezone_label = upper(trim(p_timezone_label)),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      sales_start_at = p_sales_start_at,
      sales_end_at = p_sales_end_at,
      status = p_status,
      image_path = nullif(trim(p_image_path), ''),
      rejection_reason = null,
      published_at = null,
      version = version + 1,
      updated_at = now()
    where id = saved_event_id;
  end if;

  delete from public.event_schedule_items where event_id = saved_event_id;
  for schedule_item in select value from jsonb_array_elements(p_schedule)
  loop
    insert into public.event_schedule_items (event_id, start_time, item_label, sort_order)
    values (
      saved_event_id,
      (schedule_item ->> 'time')::time,
      trim(schedule_item ->> 'title'),
      coalesce((schedule_item ->> 'sort_order')::integer, 0)
    );
  end loop;

  delete from public.event_policies where event_id = saved_event_id;
  for policy_item in select value from jsonb_array_elements(p_policies)
  loop
    insert into public.event_policies (event_id, policy_text, sort_order)
    values (
      saved_event_id,
      trim(policy_item ->> 'text'),
      coalesce((policy_item ->> 'sort_order')::integer, 0)
    );
  end loop;

  -- Move current positions out of the requested range before applying a new
  -- order so swaps cannot collide with the immediate unique constraint.
  update public.ticket_types
  set sort_order = sort_order + 1000
  where event_id = saved_event_id;

  -- Temporarily free the requested names so existing tiers can exchange names
  -- without colliding with the immediate event/name uniqueness check.
  kept_ticket_ids := array(
    select (value ->> 'id')::uuid
    from jsonb_array_elements(p_ticket_types)
    where coalesce(value ->> 'id', '') <> ''
  );
  update public.ticket_types
  set name = '__editing__' || replace(id::text, '-', '')
  where event_id = saved_event_id
    and id = any(kept_ticket_ids);
  kept_ticket_ids := array[]::uuid[];

  for ticket_item in select value from jsonb_array_elements(p_ticket_types)
  loop
    ticket_total := (ticket_item ->> 'quantity_total')::integer;
    ticket_admissions := coalesce((ticket_item ->> 'admissions_per_ticket')::integer, 1);
    if ticket_admissions not between 1 and 100 or ticket_total % ticket_admissions <> 0 then
      raise exception 'Group ticket size or admission capacity is invalid.';
    end if;
    ticket_min := (ticket_item ->> 'min_per_order')::integer;
    ticket_max := (ticket_item ->> 'max_per_order')::integer;
    ticket_price := (ticket_item ->> 'price_kobo')::bigint;
    ticket_active := coalesce((ticket_item ->> 'active')::boolean, true);
    ticket_sales_start := nullif(ticket_item ->> 'sales_start_at', '')::timestamptz;
    ticket_sales_end := nullif(ticket_item ->> 'sales_end_at', '')::timestamptz;
    ticket_id := null;

    if ticket_total < 0 or ticket_price < 0 or ticket_min < 1
      or ticket_max < ticket_min or ticket_max > 20 then
      raise exception 'A ticket tier has invalid pricing or inventory limits.';
    end if;
    if ticket_sales_start is not null and ticket_sales_end is not null
      and ticket_sales_end <= ticket_sales_start then
      raise exception 'A ticket sales end must be after its start.';
    end if;

    if coalesce(ticket_item ->> 'id', '') <> '' then
      ticket_id := (ticket_item ->> 'id')::uuid;
      select * into locked_ticket
      from public.ticket_types
      where id = ticket_id and event_id = saved_event_id
      for update;

      if not found then
        raise exception 'A ticket tier was not found.';
      end if;
    else
      select * into locked_ticket
      from public.ticket_types
      where event_id = saved_event_id and name = trim(ticket_item ->> 'name')
      for update;
      if found then ticket_id := locked_ticket.id; end if;
    end if;

    if ticket_id is not null then
      if ticket_total < locked_ticket.quantity_sold + locked_ticket.quantity_reserved then
        raise exception 'Ticket capacity cannot be below sold and reserved inventory.';
      end if;
      update public.ticket_types
      set
        name = trim(ticket_item ->> 'name'),
        description = nullif(trim(ticket_item ->> 'description'), ''),
        price_kobo = ticket_price,
        quantity_total = ticket_total,
        admissions_per_ticket = ticket_admissions,
        min_per_order = ticket_min,
        max_per_order = ticket_max,
        sales_start_at = ticket_sales_start,
        sales_end_at = ticket_sales_end,
        inclusions = coalesce(ticket_item -> 'inclusions', '[]'::jsonb),
        sort_order = coalesce((ticket_item ->> 'sort_order')::integer, 0),
        active = ticket_active
      where id = ticket_id;
    else
      insert into public.ticket_types (
        event_id,
        name,
        description,
        price_kobo,
        quantity_total,
        admissions_per_ticket,
        min_per_order,
        max_per_order,
        sales_start_at,
        sales_end_at,
        inclusions,
        sort_order,
        active
      ) values (
        saved_event_id,
        trim(ticket_item ->> 'name'),
        nullif(trim(ticket_item ->> 'description'), ''),
        ticket_price,
        ticket_total,
        ticket_admissions,
        ticket_min,
        ticket_max,
        ticket_sales_start,
        ticket_sales_end,
        coalesce(ticket_item -> 'inclusions', '[]'::jsonb),
        coalesce((ticket_item ->> 'sort_order')::integer, 0),
        ticket_active
      ) returning id into ticket_id;
    end if;

    kept_ticket_ids := array_append(kept_ticket_ids, ticket_id);
  end loop;

  update public.ticket_types
  set active = false
  where event_id = saved_event_id
    and not (id = any(kept_ticket_ids));

  update public.events set updated_at = now() where id = saved_event_id;
  return saved_event_id;
end;
$$;


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
      or jsonb_array_length(attendee_data) <> admission_quantity then
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
      attendee_data
    ) values (
      new_order.id,
      ticket.id,
      item_quantity,
      ticket.admissions_per_ticket,
      ticket.price_kobo,
      ticket.price_kobo * item_quantity,
      attendee_data
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
      reservation.id as reservation_id
    from public.order_items as order_item
    join public.reservations as reservation on reservation.order_item_id = order_item.id
    where order_item.order_id = p_order_id
      and reservation.released_at is null
      and reservation.converted_at is null
    order by order_item.id
    for update of order_item, reservation
  loop
    if item.reserved_admissions <> item.quantity or jsonb_array_length(item.attendee_data) <> item.quantity then
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

