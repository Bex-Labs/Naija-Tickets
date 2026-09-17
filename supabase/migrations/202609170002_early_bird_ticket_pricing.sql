alter table public.ticket_types
  add column standard_price_kobo bigint,
  add column early_bird_price_kobo bigint,
  add column early_bird_ends_at timestamptz;

update public.ticket_types
set standard_price_kobo = price_kobo
where standard_price_kobo is null;

create function public.set_ticket_standard_price_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.standard_price_kobo is null then
    new.standard_price_kobo := new.price_kobo;
  end if;
  return new;
end;
$$;

create trigger ticket_types_set_standard_price_on_insert
before insert on public.ticket_types
for each row execute function public.set_ticket_standard_price_on_insert();

revoke all on function public.set_ticket_standard_price_on_insert() from public;

alter table public.ticket_types
  alter column standard_price_kobo set not null,
  add constraint ticket_types_standard_price_nonnegative
    check (standard_price_kobo >= 0),
  add constraint ticket_types_early_bird_pair
    check (
      (early_bird_price_kobo is null and early_bird_ends_at is null)
      or
      (early_bird_price_kobo is not null and early_bird_ends_at is not null)
    ),
  add constraint ticket_types_early_bird_discount
    check (
      early_bird_price_kobo is null
      or (
        early_bird_price_kobo >= 0
        and early_bird_price_kobo < standard_price_kobo
      )
    );

create function public.save_organiser_event_v2(
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

    update public.ticket_types
    set
      standard_price_kobo = ticket_standard_price,
      early_bird_price_kobo = ticket_early_price,
      early_bird_ends_at = ticket_early_end,
      price_kobo = case
        when ticket_early_price is not null and ticket_early_end > now()
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
  created_order record;
  stored_rule jsonb;
  basis_points integer := 500;
  fixed_kobo_per_ticket integer := 0;
  ticket_quantity integer := 0;
  calculated_fee bigint := 0;
begin
  if jsonb_typeof(p_items) = 'array' then
    update public.ticket_types as ticket
    set price_kobo = case
      when ticket.early_bird_price_kobo is not null
        and ticket.early_bird_ends_at > now()
        then ticket.early_bird_price_kobo
      else ticket.standard_price_kobo
    end
    where ticket.event_id = p_event_id
      and ticket.id in (
        select (item.value ->> 'ticket_type_id')::uuid
        from jsonb_array_elements(p_items) as item(value)
      );
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

comment on function public.save_organiser_event_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
)
is 'Atomically saves an organiser event with optional early bird pricing that becomes the standard price at its deadline.';

comment on function public.create_checkout_reservation_v2(uuid, uuid, jsonb, jsonb, text)
is 'Creates a server-priced reservation, applying an active early bird discount and the current database platform fee.';
