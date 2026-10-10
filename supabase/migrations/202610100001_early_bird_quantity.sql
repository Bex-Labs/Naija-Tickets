-- The early bird allocation is in purchasable packages, just like order_items.quantity.
-- It is part of the existing tier capacity, never additional event inventory.
alter table public.ticket_types add column early_bird_quantity integer
  check (early_bird_quantity is null or early_bird_quantity > 0);
alter table public.order_items add column early_bird_applied boolean not null default false;

-- Preserve existing discounted purchases when an organiser adds a limit later.
update public.order_items as item set early_bird_applied = true
from public.ticket_types as ticket
where item.ticket_type_id = ticket.id
  and ticket.early_bird_price_kobo is not null
  and item.unit_price_kobo = ticket.early_bird_price_kobo;
create index order_items_early_bird_ticket_type_idx
  on public.order_items(ticket_type_id) where early_bird_applied;

create function public.early_bird_packages_used(p_ticket_type_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(item.quantity), 0)::integer
  from public.order_items as item join public.orders as booking on booking.id = item.order_id
  where item.ticket_type_id = p_ticket_type_id and item.early_bird_applied
    and (booking.status in ('paid', 'partially_refunded', 'refunded')
      or (booking.status = 'pending' and exists (
        select 1 from public.reservations as hold
        where hold.order_item_id = item.id and hold.released_at is null
          and hold.converted_at is null and hold.expires_at > now()
      )));
$$;
revoke all on function public.early_bird_packages_used(uuid) from public, anon, authenticated;
grant execute on function public.early_bird_packages_used(uuid) to service_role;

-- PostgREST computed field: exposes only the remaining package count, never
-- order or purchaser information. Re-read the real tier instead of trusting
-- caller-supplied composite values, and preserve event visibility checks.
create function public.early_bird_remaining(public.ticket_types)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(0, ticket.early_bird_quantity - public.early_bird_packages_used(ticket.id))
  from public.ticket_types as ticket join public.events as event on event.id = ticket.event_id
  where ticket.id = ($1).id and ticket.early_bird_quantity is not null
    and (current_setting('role', true) = 'service_role'
      or (event.status = 'published' and event.ends_at > now())
      or public.is_organiser_member(event.organiser_id) or public.has_role('administrator'));
$$;
revoke all on function public.early_bird_remaining(public.ticket_types) from public;
grant execute on function public.early_bird_remaining(public.ticket_types) to anon, authenticated, service_role;

-- Snapshot which price was used. Later edits, promo codes and payment/refund
-- transitions cannot change how many early bird packages a booking consumed.
create function public.snapshot_early_bird_order_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ticket public.ticket_types%rowtype;
  remaining_packages integer;
begin
  select * into ticket from public.ticket_types where id = new.ticket_type_id for update;
  new.early_bird_applied := ticket.early_bird_price_kobo is not null
    and ticket.early_bird_ends_at > now() and new.unit_price_kobo = ticket.early_bird_price_kobo;
  if new.early_bird_applied and ticket.early_bird_quantity is not null then
    remaining_packages := ticket.early_bird_quantity - public.early_bird_packages_used(ticket.id);
    if new.quantity > remaining_packages then
      raise exception 'Only % early bird tickets are available for %.', greatest(0, remaining_packages), ticket.name;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.snapshot_early_bird_order_item() from public, anon, authenticated;
create trigger order_items_snapshot_early_bird
before insert on public.order_items for each row execute function public.snapshot_early_bird_order_item();

create or replace function public.save_organiser_event_v2(
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
  ticket_item jsonb;
  saved_ticket public.ticket_types%rowtype;
  ticket_standard_price bigint;
  ticket_early_price bigint;
  ticket_early_end timestamptz;
  ticket_early_quantity integer;
begin
  saved_event_id := public.save_organiser_event(
    p_user_id,
    p_event_id,
    p_organiser_id,
    p_category_id,
    p_title,
    p_presenter_line,
    p_description,
    p_venue_name,
    p_address,
    p_directions_url,
    p_city,
    p_state,
    p_timezone,
    p_timezone_label,
    p_starts_at,
    p_ends_at,
    p_sales_start_at,
    p_sales_end_at,
    p_status,
    p_image_path,
    p_organiser_name,
    p_organiser_description,
    p_schedule,
    p_policies,
    p_ticket_types
  );

  for ticket_item in select value from jsonb_array_elements(p_ticket_types)
  loop
    ticket_standard_price := (ticket_item ->> 'price_kobo')::bigint;
    ticket_early_price := nullif(ticket_item ->> 'early_bird_price_kobo', '')::bigint;
    ticket_early_end := nullif(ticket_item ->> 'early_bird_ends_at', '')::timestamptz;

    if (ticket_early_price is null) <> (ticket_early_end is null) then
      raise exception 'Early bird pricing needs both a discounted price and an end date.';
    end if;
    if ticket_early_price is not null
      and (ticket_early_price < 0 or ticket_early_price >= ticket_standard_price) then
      raise exception 'The early bird price must be lower than the standard price.';
    end if;

    if coalesce(ticket_item ->> 'id', '') <> '' then
      select * into saved_ticket
      from public.ticket_types
      where id = (ticket_item ->> 'id')::uuid
        and event_id = saved_event_id
      for update;
    else
      select * into saved_ticket
      from public.ticket_types
      where event_id = saved_event_id
        and name = trim(ticket_item ->> 'name')
      for update;
    end if;

    if not found then
      raise exception 'A ticket tier was not found.';
    end if;
    if ticket_early_end is not null
      and saved_ticket.sales_start_at is not null
      and ticket_early_end <= saved_ticket.sales_start_at then
      raise exception 'The early bird deadline must be after ticket sales start.';
    end if;
    if ticket_early_end is not null
      and saved_ticket.sales_end_at is not null
      and ticket_early_end >= saved_ticket.sales_end_at then
      raise exception 'The early bird deadline must be before ticket sales end.';
    end if;

    ticket_early_quantity := case when ticket_early_price is not null then
      coalesce(nullif(ticket_item ->> 'early_bird_quantity', '')::integer,
        saved_ticket.quantity_total / saved_ticket.admissions_per_ticket)
      else null end;
    if ticket_early_quantity is not null and (
      ticket_early_quantity < 1
      or ticket_early_quantity > saved_ticket.quantity_total / saved_ticket.admissions_per_ticket
      or ticket_early_quantity < public.early_bird_packages_used(saved_ticket.id)
    ) then
      raise exception 'Early bird quantity must cover existing early bird bookings and fit within the total ticket quantity.';
    end if;

    update public.ticket_types
    set
      early_bird_quantity = ticket_early_quantity,
      standard_price_kobo = ticket_standard_price,
      early_bird_price_kobo = ticket_early_price,
      early_bird_ends_at = ticket_early_end,
      price_kobo = case
        when ticket_early_price is not null and ticket_early_end > now()
          and ticket_early_quantity > public.early_bird_packages_used(saved_ticket.id)
          then ticket_early_price
        else ticket_standard_price
      end
    where id = saved_ticket.id;
  end loop;

  return saved_event_id;
end;
$$;

revoke all on function public.save_organiser_event_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
) from public;

grant execute on function public.save_organiser_event_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
) to service_role;

revoke execute on function public.save_organiser_event(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
) from service_role;

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
  selected_ticket public.ticket_types%rowtype;
  available_early integer;
  requested_quantity integer;
  created_order record;
  stored_rule jsonb;
  basis_points integer := 500;
  fixed_kobo_per_ticket integer := 0;
  ticket_quantity integer := 0;
  calculated_fee bigint := 0;
begin
  if jsonb_typeof(p_items) = 'array' then
    -- Lock before counting reservations so competing checkouts cannot both
    -- consume the final discounted packages. Order consistently across tiers.
    for selected_ticket in
      select ticket.* from public.ticket_types as ticket
      where ticket.event_id = p_event_id and ticket.id in (
        select (item.value ->> 'ticket_type_id')::uuid
        from jsonb_array_elements(p_items) as item(value)
      )
      order by ticket.id for update of ticket
    loop
      available_early := selected_ticket.early_bird_quantity
        - public.early_bird_packages_used(selected_ticket.id);
      if selected_ticket.early_bird_price_kobo is not null
        and selected_ticket.early_bird_ends_at > now()
        and (available_early is null or available_early > 0) then
        select sum((item.value ->> 'quantity')::integer)::integer
        into requested_quantity from jsonb_array_elements(p_items) as item(value)
        where (item.value ->> 'ticket_type_id')::uuid = selected_ticket.id;
        if requested_quantity > available_early then
          raise exception 'Only % early bird tickets are available for %. Choose fewer tickets or refresh after the early bird allocation sells out.', available_early, selected_ticket.name;
        end if;
        update public.ticket_types set price_kobo = selected_ticket.early_bird_price_kobo
        where id = selected_ticket.id;
      else
        update public.ticket_types set price_kobo = selected_ticket.standard_price_kobo
        where id = selected_ticket.id;
      end if;
    end loop;
  end if;

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

revoke all on function public.create_checkout_reservation_v2(uuid, uuid, jsonb, jsonb, text) from public;
grant execute on function public.create_checkout_reservation_v2(uuid, uuid, jsonb, jsonb, text) to service_role;


notify pgrst, 'reload schema';
