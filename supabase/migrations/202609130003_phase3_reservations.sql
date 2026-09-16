-- Phase 3: create orders and reserve ticket inventory atomically.
create or replace function public.create_checkout_reservation(
  p_customer_id uuid,
  p_event_id uuid,
  p_items jsonb,
  p_fee_basis_points integer default 500
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

  if not exists (select 1 from public.profiles where id = p_customer_id) then
    raise exception 'Customer account is not available.';
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
    from public.reservations reservation
    join public.order_items order_item on order_item.id = reservation.order_item_id
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
    reservation_expires_at
  ) values (
    p_customer_id,
    p_event_id,
    'pending',
    held_until
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
    if jsonb_typeof(attendee_data) <> 'array' or jsonb_array_length(attendee_data) <> item_quantity then
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

revoke all on function public.create_checkout_reservation(uuid, uuid, jsonb, integer) from public;
grant execute on function public.create_checkout_reservation(uuid, uuid, jsonb, integer) to service_role;

comment on function public.create_checkout_reservation(uuid, uuid, jsonb, integer)
is 'Creates a pending order and reserves all selected inventory in one transaction.';
