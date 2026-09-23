-- Give unverified organisers a restricted free-event tier while keeping the
-- limits authoritative in PostgreSQL.

create or replace function public.enforce_unverified_event_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organisers
    where id = new.organiser_id and verified_at is not null
  ) and (
    select count(*) from public.events
    where organiser_id = new.organiser_id
      and status not in ('cancelled', 'completed')
  ) >= 2 then
    raise exception 'Unverified organisers can create a maximum of 2 active events.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_unverified_event_count_before_insert on public.events;
create trigger enforce_unverified_event_count_before_insert
before insert on public.events
for each row execute function public.enforce_unverified_event_count();

create or replace function public.enforce_unverified_ticket_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  target_organiser_id uuid;
  limited_capacity bigint;
begin
  select organiser_id into target_organiser_id
  from public.events where id = target_event_id;

  if target_organiser_id is null or exists (
    select 1 from public.organisers
    where id = target_organiser_id and verified_at is not null
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    select 1 from public.ticket_types
    where event_id = target_event_id
      and (
        (active and (standard_price_kobo > 0 or price_kobo > 0 or early_bird_price_kobo is not null))
        or (not active and quantity_sold + quantity_reserved > 0 and standard_price_kobo > 0)
      )
  ) then
    raise exception 'Unverified organisers can sell free tickets only.'
      using errcode = '23514';
  end if;

  select coalesce(sum(
    case when active then quantity_total else quantity_sold + quantity_reserved end
  ), 0)
  into limited_capacity
  from public.ticket_types
  where event_id = target_event_id;

  if limited_capacity > 100 then
    raise exception 'Unverified organisers can offer a maximum of 100 tickets per event.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_unverified_ticket_limits_after_change on public.ticket_types;
create constraint trigger enforce_unverified_ticket_limits_after_change
after insert or update or delete on public.ticket_types
deferrable initially deferred
for each row execute function public.enforce_unverified_ticket_limits();

create or replace function public.require_verified_organiser_for_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  published_event_count integer;
  limited_capacity bigint;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;
  if exists (
    select 1 from public.organisers
    where id = new.organiser_id and verified_at is not null
  ) then
    return new;
  end if;

  if new.featured then
    raise exception 'Unverified organiser events cannot be featured.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.ticket_types where event_id = new.id)
    or exists (
      select 1 from public.ticket_types
      where event_id = new.id
        and (standard_price_kobo > 0 or price_kobo > 0 or early_bird_price_kobo is not null)
    ) then
    raise exception 'Unverified organisers can publish free-ticket events only.'
      using errcode = '23514';
  end if;

  select coalesce(sum(
    case when active then quantity_total else quantity_sold + quantity_reserved end
  ), 0)
  into limited_capacity
  from public.ticket_types where event_id = new.id;
  if limited_capacity > 100 then
    raise exception 'Unverified organiser events are limited to 100 tickets.'
      using errcode = '23514';
  end if;

  select count(*) into published_event_count
  from public.events
  where organiser_id = new.organiser_id
    and status = 'published'
    and id <> new.id;
  if published_event_count >= 2 then
    raise exception 'Unverified organisers can publish a maximum of 2 events.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_unverified_featured_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.featured and not exists (
    select 1 from public.organisers
    where id = new.organiser_id and verified_at is not null
  ) then
    raise exception 'Only verified organiser events can be featured.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_unverified_featured_before_write on public.events;
create trigger enforce_unverified_featured_before_write
before insert or update of featured on public.events
for each row execute function public.enforce_unverified_featured_eligibility();

create or replace function public.enforce_unverified_membership_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organisers
    where id = new.organiser_id and verified_at is not null
  ) and exists (
    select 1 from public.organiser_memberships
    where organiser_id = new.organiser_id
  ) then
    raise exception 'Unverified organisers can have only 1 administrator.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_unverified_membership_before_insert on public.organiser_memberships;
create trigger enforce_unverified_membership_before_insert
before insert on public.organiser_memberships
for each row execute function public.enforce_unverified_membership_limit();

create or replace function public.create_organiser_promo_code(
  p_user_id uuid, p_event_id uuid, p_code text, p_discount_type text,
  p_discount_value bigint, p_starts_at timestamptz, p_ends_at timestamptz,
  p_usage_limit integer, p_ticket_type_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
begin
  if not exists (
    select 1 from public.events e
    join public.organiser_memberships m on m.organiser_id = e.organiser_id
    where e.id = p_event_id and m.user_id = p_user_id
  ) then raise exception 'Event not found or access unavailable.'; end if;
  if not exists (
    select 1 from public.events e join public.organisers o on o.id = e.organiser_id
    where e.id = p_event_id and o.verified_at is not null
  ) then raise exception 'Verify your organiser account to create promo codes.' using errcode = '42501'; end if;
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

create or replace function public.remove_unverified_discovery_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.verified_at is not null and new.verified_at is null then
    update public.events
    set featured = false,
        updated_at = now()
    where organiser_id = new.id and featured;

    update public.promo_codes as promo
    set active = false
    from public.events as event
    where promo.event_id = event.id and event.organiser_id = new.id;

    update public.events as event
    set status = 'submitted', published_at = null, updated_at = now()
    where event.organiser_id = new.id
      and event.status = 'published'
      and (
        not exists (select 1 from public.ticket_types t where t.event_id = event.id)
        or exists (
          select 1 from public.ticket_types t
          where t.event_id = event.id
            and (t.standard_price_kobo > 0 or t.price_kobo > 0 or t.early_bird_price_kobo is not null)
        )
        or 100 < (
          select coalesce(sum(case when t.active then t.quantity_total else t.quantity_sold + t.quantity_reserved end), 0)
          from public.ticket_types t where t.event_id = event.id
        )
      );

    with ranked as (
      select id, row_number() over (order by published_at nulls last, created_at, id) as position
      from public.events where organiser_id = new.id and status = 'published'
    )
    update public.events as event
    set status = 'submitted', published_at = null, updated_at = now()
    from ranked where event.id = ranked.id and ranked.position > 2;

    delete from public.organiser_memberships as membership
    where membership.organiser_id = new.id
      and (membership.organiser_id, membership.user_id) not in (
        select kept.organiser_id, kept.user_id
        from public.organiser_memberships as kept
        where kept.organiser_id = new.id
        order by kept.created_at, kept.user_id
        limit 1
      );
  end if;
  return new;
end;
$$;

drop trigger if exists remove_unverified_discovery_after_update on public.organisers;
create trigger remove_unverified_discovery_after_update
after update of verified_at on public.organisers
for each row execute function public.remove_unverified_discovery_eligibility();

-- Bring records created before this policy into compliance.
update public.events as event
set featured = false, updated_at = now()
from public.organisers as organiser
where organiser.id = event.organiser_id
  and organiser.verified_at is null
  and event.featured;

update public.promo_codes as promo
set active = false
from public.events as event
join public.organisers as organiser on organiser.id = event.organiser_id
where promo.event_id = event.id and organiser.verified_at is null;

update public.events as event
set status = 'submitted', published_at = null, updated_at = now()
from public.organisers as organiser
where organiser.id = event.organiser_id
  and organiser.verified_at is null
  and event.status = 'published'
  and (
    not exists (select 1 from public.ticket_types t where t.event_id = event.id)
    or exists (
      select 1 from public.ticket_types t
      where t.event_id = event.id
        and (t.standard_price_kobo > 0 or t.price_kobo > 0 or t.early_bird_price_kobo is not null)
    )
    or 100 < (
      select coalesce(sum(case when t.active then t.quantity_total else t.quantity_sold + t.quantity_reserved end), 0)
      from public.ticket_types t where t.event_id = event.id
    )
  );

with ranked as (
  select event.id,
    row_number() over (
      partition by event.organiser_id
      order by event.published_at nulls last, event.created_at, event.id
    ) as position
  from public.events as event
  join public.organisers as organiser on organiser.id = event.organiser_id
  where organiser.verified_at is null and event.status = 'published'
)
update public.events as event
set status = 'submitted', published_at = null, updated_at = now()
from ranked where event.id = ranked.id and ranked.position > 2;

with ranked as (
  select membership.organiser_id, membership.user_id,
    row_number() over (
      partition by membership.organiser_id
      order by membership.created_at, membership.user_id
    ) as position
  from public.organiser_memberships as membership
  join public.organisers as organiser on organiser.id = membership.organiser_id
  where organiser.verified_at is null
)
delete from public.organiser_memberships as membership
using ranked
where membership.organiser_id = ranked.organiser_id
  and membership.user_id = ranked.user_id
  and ranked.position > 1;

revoke all on function public.enforce_unverified_event_count() from public, anon, authenticated;
revoke all on function public.enforce_unverified_ticket_limits() from public, anon, authenticated;
revoke all on function public.require_verified_organiser_for_publication() from public, anon, authenticated;
revoke all on function public.enforce_unverified_featured_eligibility() from public, anon, authenticated;
revoke all on function public.enforce_unverified_membership_limit() from public, anon, authenticated;
revoke all on function public.remove_unverified_discovery_eligibility() from public, anon, authenticated;
