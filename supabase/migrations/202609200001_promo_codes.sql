-- Codes are private to organisers. A redemption is one booking, including its live hold.
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value bigint not null check (discount_value > 0 and discount_value <= 100000000),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  usage_limit integer not null check (usage_limit between 1 and 1000000),
  ticket_type_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percentage' or discount_value <= 10000),
  unique (event_id, code)
);
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;
grant select, insert, update on public.promo_codes to service_role;

-- Subtotal stays the sum of ticket prices; discount is recorded separately.
alter table public.orders
  add column promo_code_id uuid references public.promo_codes(id),
  add column discount_kobo bigint not null default 0 check (discount_kobo >= 0 and discount_kobo <= subtotal_kobo);
alter table public.orders drop constraint orders_check;
alter table public.orders add constraint orders_total_kobo_check
  check (total_kobo = subtotal_kobo - discount_kobo + fee_kobo);
create index orders_promo_code_idx on public.orders(promo_code_id) where promo_code_id is not null;

create function public.create_organiser_promo_code(
  p_user_id uuid, p_event_id uuid, p_code text, p_discount_type text,
  p_discount_value bigint, p_starts_at timestamptz, p_ends_at timestamptz,
  p_usage_limit integer, p_ticket_type_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
begin
  if not exists (
    select 1 from public.events e join public.organiser_memberships m on m.organiser_id = e.organiser_id
    where e.id = p_event_id and m.user_id = p_user_id
  ) then raise exception 'Event not found or access unavailable.'; end if;
  if p_ticket_type_ids is null or cardinality(p_ticket_type_ids) > 100 or exists (
    select 1 from unnest(p_ticket_type_ids) as selected(id)
    where not exists (select 1 from public.ticket_types t where t.id = selected.id and t.event_id = p_event_id)
  ) then raise exception 'Choose ticket types belonging to this event.'; end if;
  insert into public.promo_codes(event_id, code, discount_type, discount_value, starts_at, ends_at, usage_limit, ticket_type_ids)
  values (p_event_id, upper(trim(p_code)), p_discount_type, p_discount_value, p_starts_at, p_ends_at, p_usage_limit, p_ticket_type_ids)
  returning id into saved_id;
  return saved_id;
end;
$$;
revoke all on function public.create_organiser_promo_code(uuid, uuid, text, text, bigint, timestamptz, timestamptz, integer, uuid[]) from public;
grant execute on function public.create_organiser_promo_code(uuid, uuid, text, text, bigint, timestamptz, timestamptz, integer, uuid[]) to service_role;

create function public.create_checkout_reservation_v3(
  p_customer_id uuid, p_event_id uuid, p_items jsonb, p_purchaser jsonb,
  p_checkout_token_hash text, p_promo_code text default null
)
returns table (
  order_id uuid, reference text, expires_at timestamptz, subtotal_kobo bigint,
  fee_kobo bigint, total_kobo bigint, discount_kobo bigint, promo_code text
)
language plpgsql security definer set search_path = '' as $$
declare
  promo public.promo_codes%rowtype;
  created_order record;
  used_count bigint;
  calculated_discount bigint := 0;
  calculated_fee bigint;
  stored_rule jsonb;
  basis_points integer := 500;
begin
  if nullif(trim(p_promo_code), '') is not null then
    -- Serialise reservations for the same code before testing or consuming the limit.
    select * into promo from public.promo_codes c
    where c.event_id = p_event_id and c.code = upper(trim(p_promo_code)) for update;
    if not found or not promo.active then raise exception 'Promo code is not available for this event.'; end if;
    if promo.starts_at > now() then raise exception 'Promo code is not valid yet.'; end if;
    if promo.ends_at <= now() then raise exception 'Promo code has expired.'; end if;
  end if;

  -- Keep all existing inventory, attendee, sales-window and early bird validation.
  select * into created_order from public.create_checkout_reservation_v2(
    p_customer_id, p_event_id, p_items, p_purchaser, p_checkout_token_hash
  );
  calculated_fee := created_order.fee_kobo;

  if promo.id is not null then
    -- The reservation function first releases expired holds under row locks.
    -- Count every remaining pending order so an in-flight payment cannot be overlooked.
    select count(*) into used_count from public.orders o where o.promo_code_id = promo.id
      and o.status in ('pending', 'paid', 'refunded', 'partially_refunded');
    if used_count >= promo.usage_limit then raise exception 'Promo code usage limit has been reached.'; end if;
    -- Fixed amounts apply per eligible ticket and are capped at that ticket's price.
    select coalesce(sum(oi.quantity * case when promo.discount_type = 'percentage'
      then round(oi.unit_price_kobo::numeric * promo.discount_value / 10000)::bigint
      else least(oi.unit_price_kobo, promo.discount_value) end), 0)
    into calculated_discount from public.order_items oi
    where oi.order_id = created_order.order_id
      and (cardinality(promo.ticket_type_ids) = 0 or oi.ticket_type_id = any(promo.ticket_type_ids));
    if calculated_discount <= 0 then raise exception 'Promo code does not discount the selected tickets.'; end if;

    -- Percentage fees use the discounted subtotal; fixed per-ticket fees stay unchanged.
    select s.value into stored_rule from public.platform_settings s where s.key = 'platform_fee';
    if not coalesce(stored_rule ->> 'type' = 'fixed'
      and jsonb_typeof(stored_rule -> 'fixed_kobo_per_ticket') = 'number'
      and (stored_rule ->> 'fixed_kobo_per_ticket')::integer between 0 and 10000000, false) then
      if jsonb_typeof(stored_rule -> 'basis_points') = 'number'
        and (stored_rule ->> 'basis_points')::integer between 0 and 2500 then
        basis_points := (stored_rule ->> 'basis_points')::integer;
      elsif jsonb_typeof(stored_rule -> 'percentage') = 'number'
        and (stored_rule ->> 'percentage')::numeric between 0 and 25 then
        basis_points := round((stored_rule ->> 'percentage')::numeric * 100)::integer;
      end if;
      calculated_fee := round((created_order.subtotal_kobo - calculated_discount) * basis_points / 10000.0);
    end if;
    update public.orders o set promo_code_id = promo.id, discount_kobo = calculated_discount,
      fee_kobo = calculated_fee, total_kobo = created_order.subtotal_kobo - calculated_discount + calculated_fee
    where o.id = created_order.order_id;
  end if;
  return query select created_order.order_id, created_order.reference, created_order.expires_at,
    created_order.subtotal_kobo, calculated_fee,
    created_order.subtotal_kobo - calculated_discount + calculated_fee, calculated_discount, promo.code;
end;
$$;
revoke all on function public.create_checkout_reservation_v3(uuid, uuid, jsonb, jsonb, text, text) from public;
grant execute on function public.create_checkout_reservation_v3(uuid, uuid, jsonb, jsonb, text, text) to service_role;
