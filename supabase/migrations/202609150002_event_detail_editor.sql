-- Structured organiser event details, schedules, policies and ticket pricing.

alter table public.events
  add column if not exists presenter_line text,
  add column if not exists timezone_label text not null default 'WAT',
  add column if not exists directions_url text;

update public.events as event
set presenter_line = organiser.name || ' presents'
from public.organisers as organiser
where organiser.id = event.organiser_id
  and event.presenter_line is null;

alter table public.events
  alter column presenter_line set not null,
  add constraint events_presenter_line_length check (char_length(trim(presenter_line)) between 2 and 160),
  add constraint events_timezone_label_length check (char_length(trim(timezone_label)) between 2 and 16),
  add constraint events_directions_url_http check (directions_url is null or directions_url ~* '^https?://');

create table public.event_schedule_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  start_time time not null,
  item_label text not null check (char_length(trim(item_label)) between 2 and 160),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, sort_order)
);

create table public.event_policies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  policy_text text not null check (char_length(trim(policy_text)) between 3 and 500),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, sort_order)
);

create index event_schedule_items_event_idx
  on public.event_schedule_items (event_id, sort_order);

create index event_policies_event_idx
  on public.event_policies (event_id, sort_order);

insert into public.event_schedule_items (event_id, start_time, item_label, sort_order)
select
  event.id,
  (entry.value ->> 'time')::time,
  trim(entry.value ->> 'title'),
  (entry.ordinality - 1)::integer
from public.events as event
cross join lateral jsonb_array_elements(event.schedule) with ordinality as entry(value, ordinality)
where jsonb_typeof(event.schedule) = 'array'
  and coalesce(entry.value ->> 'time', '') ~* '^((0?[1-9]|1[0-2]):[0-5][0-9](:[0-5][0-9])?[[:space:]]*(AM|PM)|([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?)$'
  and char_length(trim(coalesce(entry.value ->> 'title', ''))) between 2 and 160
on conflict (event_id, sort_order) do nothing;

insert into public.event_policies (event_id, policy_text, sort_order)
select
  event.id,
  trim(entry.value),
  (entry.ordinality - 1)::integer
from public.events as event
cross join lateral jsonb_array_elements_text(event.policies) with ordinality as entry(value, ordinality)
where jsonb_typeof(event.policies) = 'array'
  and char_length(trim(entry.value)) between 3 and 500
on conflict (event_id, sort_order) do nothing;

alter table public.events
  drop column schedule,
  drop column policies;

alter table public.event_schedule_items enable row level security;
alter table public.event_policies enable row level security;

create policy event_schedule_visible on public.event_schedule_items
for select using (
  exists (
    select 1 from public.events as event
    where event.id = event_schedule_items.event_id
      and (
        event.status = 'published'
        or public.is_organiser_member(event.organiser_id)
        or public.has_role('administrator')
      )
  )
);

create policy event_policies_visible on public.event_policies
for select using (
  exists (
    select 1 from public.events as event
    where event.id = event_policies.event_id
      and (
        event.status = 'published'
        or public.is_organiser_member(event.organiser_id)
        or public.has_role('administrator')
      )
  )
);

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

revoke all on function public.save_organiser_event(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
) from public;

grant execute on function public.save_organiser_event(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
) to service_role;

comment on function public.save_organiser_event(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz,
  public.event_status, text, text, text, jsonb, jsonb, jsonb
)
is 'Atomically saves one organiser-owned event, its ordered public details and its server-priced ticket tiers.';
