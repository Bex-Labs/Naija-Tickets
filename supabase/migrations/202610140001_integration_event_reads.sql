-- Phase 2: narrow, private, read-only projections of the existing catalogue.
-- Existing keys keep their original scopes. Rotation still preserves scopes.
alter table public.integration_api_keys drop constraint integration_api_keys_scopes_check;
alter table public.integration_api_keys add constraint integration_api_keys_scopes_check check (
  scopes <@ array['integration:read','events:read','tickets:read','availability:read']::text[]
  and cardinality(scopes) <= 4 and array_position(scopes,null) is null
);
alter table public.integration_request_logs drop constraint integration_request_logs_route_check;
alter table public.integration_request_logs add constraint integration_request_logs_route_check check (
  route in ('integration.introspect','api.not_found','events.list','events.detail','events.tickets','events.availability')
);

create or replace function public.issue_organiser_integration_key(
  p_user_id uuid,p_integration_id uuid,p_key_id uuid,p_digest text,p_prefix text,p_suffix text,
  p_environment text,p_scopes text[],p_expires_at timestamptz,p_rotate_key_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare app public.integrations%rowtype; previous public.integration_api_keys%rowtype;
begin
  select * into app from public.integrations where id=p_integration_id for update;
  if not found or not public.lock_integration_manager(p_user_id,app.organiser_id) then
    raise exception 'Integration not found.' using errcode='P0002'; end if;
  if app.status<>'active' then raise exception 'Enable this integration before issuing keys.' using errcode='22023'; end if;
  if p_key_id is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or p_environment is null or p_environment not in ('test','live')
    or p_prefix is distinct from 'nt_'||p_environment||'_'||substr(replace(p_key_id::text,'-',''),1,8)
    or p_suffix is null or p_suffix !~ '^[A-Za-z0-9_-]{4}$'
    or p_scopes is null or not(p_scopes <@ array['integration:read','events:read','tickets:read','availability:read']::text[]) or cardinality(p_scopes)>4
    or array_position(p_scopes,null) is not null
    or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '366 days' then
    raise exception 'Invalid API key configuration.' using errcode='22023'; end if;
  if p_rotate_key_id is not null then
    select * into previous from public.integration_api_keys where id=p_rotate_key_id and integration_id=app.id for update;
    if not found then raise exception 'API key not found.' using errcode='P0002'; end if;
    if previous.environment<>p_environment then raise exception 'Key mode cannot change during rotation.' using errcode='22023'; end if;
    p_scopes:=previous.scopes;
    update public.integration_api_keys set revoked_at=coalesce(revoked_at,now()) where id=previous.id;
  end if;
  if (select count(*) from public.integration_api_keys where integration_id=app.id and revoked_at is null and expires_at>now())>=20 then
    raise exception 'Revoke an unused key before creating another (20 active keys maximum).' using errcode='22023'; end if;
  insert into public.integration_api_keys(id,integration_id,organiser_id,credential_digest,display_prefix,display_suffix,
    environment,scopes,created_by,expires_at) values(p_key_id,app.id,app.organiser_id,p_digest,p_prefix,p_suffix,
    p_environment,p_scopes,p_user_id,p_expires_at);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(p_user_id,case when p_rotate_key_id is null then 'integration.key_created' else 'integration.key_rotated' end,
      'integration_key',p_key_id::text,jsonb_build_object('integration_id',app.id,'environment',p_environment,'previous_key_id',p_rotate_key_id));
  return public.integration_public_metadata(app.id);
end; $$;

-- This source contains live business records. No sandbox is provisioned here.
-- Test resource access is deliberately impossible; never resolve a test key to
-- these tables. A future isolated adapter requires its own reviewed binding.
create function public.require_integration_event_reader(
  p_key_id uuid,p_digest text,p_environment text,p_scope text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare identity jsonb;
begin
  identity := public.authenticate_integration_key(p_key_id,p_digest,p_environment);
  if identity is null then raise exception 'Invalid API key.' using errcode='NT401'; end if;
  if not ((identity->'scopes') ? p_scope) then
    raise exception 'Insufficient scope.' using errcode='NT403'; end if;
  if p_environment='test' then
    raise exception 'Sandbox not configured.' using errcode='NT503'; end if;
  if p_environment is distinct from 'live' then
    raise exception 'Invalid API key.' using errcode='NT401'; end if;
  return identity;
end; $$;

-- Explicit public projection; no contact details, verification documents or
-- purchaser/ticket capabilities. No marketplace fallback/demo records.
create function public.integration_event_projection(p_event public.events)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',e.id,'title',e.title,'slug',e.slug,'description',e.description,
    'image_url',e.image_path,'venue_name',e.venue_name,'address',e.address,'city',e.city,'state',e.state,
    'starts_at',e.starts_at,'ends_at',e.ends_at,'timezone',e.timezone,
    'sales_start_at',e.sales_start_at,'sales_end_at',e.sales_end_at,
    'organiser',jsonb_build_object('id',o.id,'name',o.name,'verified',o.verified_at is not null),
    'category',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug))
  from public.events e join public.organisers o on o.id=e.organiser_id
    join public.categories c on c.id=e.category_id where e.id=(p_event).id;
$$;

-- Shared read snapshot uses the reservation engine's admission counters less
-- expired, unreleased holds (the same holds checkout cleans before purchasing).
-- It does not release holds, create orders or modify the stored price. Discount
-- usage reuses the existing early_bird_packages_used function, including paid
-- unclaimed group slots and refunded purchases exactly as the current engine.
create function public.integration_ticket_snapshot(p_event_id uuid)
returns table(id uuid,sort_order integer,ticket jsonb,availability jsonb)
language sql stable security definer set search_path = '' as $$
  with inventory as (
    select t.*, e.sales_start_at as event_sales_start, e.sales_end_at as event_sales_end,
      greatest(0,t.quantity_reserved-coalesce((select sum(r.quantity) from public.reservations r
        where r.ticket_type_id=t.id and r.released_at is null and r.converted_at is null
          and r.expires_at<=now()),0)) as live_reserved,
      case when t.early_bird_quantity is null then null else
        greatest(0,t.early_bird_quantity-public.early_bird_packages_used(t.id)) end as early_remaining
    from public.ticket_types t join public.events e on e.id=t.event_id
    where t.event_id=p_event_id and t.active
  ), priced as (
    select i.*,greatest(0,i.quantity_total-i.quantity_sold-i.live_reserved) as remaining,
      i.early_bird_price_kobo is not null and i.early_bird_ends_at>now()
        and (i.early_remaining is null or i.early_remaining>0) as early_active,
      least(i.max_per_order,400/i.admissions_per_ticket) as maximum
    from inventory i
  ), sale as (
    select p.*,case
      when (p.sales_end_at is not null and p.sales_end_at<=now())
        or (p.event_sales_end is not null and p.event_sales_end<=now()) then 'closed'
      when (p.sales_start_at is not null and p.sales_start_at>now())
        or (p.event_sales_start is not null and p.event_sales_start>now()) then 'upcoming'
      when p.remaining/p.admissions_per_ticket<p.min_per_order or p.maximum<p.min_per_order then 'sold_out'
      when p.early_active and p.early_remaining<p.min_per_order then 'allocation_limited'
      else 'open' end as sale_status
    from priced p
  ) select s.id,s.sort_order,
    jsonb_build_object('id',s.id,'event_id',s.event_id,'name',s.name,'description',s.description,
      'price_kobo',(case when s.early_active then s.early_bird_price_kobo else s.standard_price_kobo end)::text,
      'standard_price_kobo',s.standard_price_kobo::text,'price_kind',case when s.early_active then 'early_bird' else 'standard' end,
      'early_bird_price_kobo',s.early_bird_price_kobo::text,'early_bird_ends_at',s.early_bird_ends_at,
      'admissions_per_ticket',s.admissions_per_ticket,'min_packages_per_order',s.min_per_order,'max_packages_per_order',s.maximum,
      'sales_start_at',greatest(s.sales_start_at,s.event_sales_start),'sales_end_at',least(s.sales_end_at,s.event_sales_end),
      'sale_status',s.sale_status,'sort_order',s.sort_order),
    jsonb_build_object('ticket_type_id',s.id,'admissions_per_ticket',s.admissions_per_ticket,
      'total_admissions',s.quantity_total,'sold_admissions',s.quantity_sold,'reserved_admissions',s.live_reserved,
      'remaining_admissions',s.remaining,'remaining_packages',s.remaining/s.admissions_per_ticket,
      'early_bird_remaining_packages',case when s.early_active then s.early_remaining else null end,
      'max_packages_at_current_price',case when s.sale_status<>'open' then 0 else
        least(s.remaining/s.admissions_per_ticket,s.maximum,
          case when s.early_active then coalesce(s.early_remaining,s.maximum) else s.maximum end) end,
      'sale_status',s.sale_status)
  from sale s;
$$;

create function public.read_integration_events(
  p_key_id uuid,p_digest text,p_environment text,p_operation text,
  p_event_id uuid default null,p_limit integer default 20,
  p_city text default null,p_category text default null,
  p_starts_from timestamptz default null,p_starts_before timestamptz default null,
  p_after_id uuid default null,p_after_start timestamptz default null,p_after_sort integer default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare identity jsonb; required_scope text; event_row public.events%rowtype; result jsonb;
begin
  required_scope := case p_operation when 'list' then 'events:read' when 'detail' then 'events:read'
    when 'tickets' then 'tickets:read' when 'availability' then 'availability:read' end;
  if required_scope is null or p_limit is null or p_limit not between 1 and 100
    or char_length(p_city)>80 or char_length(p_category)>64
    or (p_starts_from is not null and p_starts_before is not null and p_starts_from>=p_starts_before)
    or (p_operation='list' and (p_after_id is null)<>(p_after_start is null))
    or (p_operation='tickets' and (p_after_id is null)<>(p_after_sort is null)) then
    raise exception 'Invalid event query.' using errcode='22023'; end if;
  -- Recheck the actual key and grants in the same transaction as the read;
  -- never trust a passed organiser ID or an earlier route authentication result.
  identity := public.require_integration_event_reader(p_key_id,p_digest,p_environment,required_scope);
  if p_operation='list' then
    select coalesce(jsonb_agg(public.integration_event_projection(page) order by page.starts_at,page.id),'[]'::jsonb)
      into result from (
        select e.* from public.events e join public.integration_event_grants g on g.event_id=e.id
          and g.organiser_id=e.organiser_id and g.integration_id=(identity->>'integrationId')::uuid
        join public.categories c on c.id=e.category_id
        where e.organiser_id=(identity->>'organiserId')::uuid and e.status='published' and e.ends_at>now()
          and (p_city is null or lower(e.city)=lower(p_city)) and (p_category is null or c.slug=p_category)
          and (p_starts_from is null or e.starts_at>=p_starts_from)
          and (p_starts_before is null or e.starts_at<p_starts_before)
          and (p_after_id is null or (e.starts_at,e.id)>(p_after_start,p_after_id))
        order by e.starts_at,e.id limit p_limit+1
      ) page;
  else
    select e.* into event_row from public.events e join public.integration_event_grants g on g.event_id=e.id
      and g.organiser_id=e.organiser_id and g.integration_id=(identity->>'integrationId')::uuid
    where e.id=p_event_id and e.organiser_id=(identity->>'organiserId')::uuid
      and e.status='published' and e.ends_at>now();
    if not found then raise exception 'Event not found.' using errcode='NT404'; end if;
    if p_operation='detail' then
      result := jsonb_build_array(public.integration_event_projection(event_row));
    else
      if (select count(*) from public.ticket_types where event_id=p_event_id and active)>100 then
        raise exception 'Catalogue too large.' using errcode='NT504'; end if;
      if p_operation='tickets' then
        select coalesce(jsonb_agg(page.ticket order by page.sort_order,page.id),'[]'::jsonb) into result
          from (select * from public.integration_ticket_snapshot(p_event_id) t
            where p_after_id is null or (t.sort_order,t.id)>(p_after_sort,p_after_id)
            order by t.sort_order,t.id limit p_limit+1) page;
      else
        select jsonb_build_array(jsonb_build_object('event_id',p_event_id,'as_of',now(),
          'total_admissions',coalesce(sum((t.availability->>'total_admissions')::bigint),0),
          'sold_admissions',coalesce(sum((t.availability->>'sold_admissions')::bigint),0),
          'reserved_admissions',coalesce(sum((t.availability->>'reserved_admissions')::bigint),0),
          'remaining_admissions',coalesce(sum((t.availability->>'remaining_admissions')::bigint),0),
          'ticket_types',coalesce(jsonb_agg(t.availability order by t.sort_order,t.id),'[]'::jsonb))) into result
          from public.integration_ticket_snapshot(p_event_id) t;
      end if;
    end if;
  end if;
  return jsonb_build_object('rows',result,'as_of',now());
end; $$;

-- Close the earlier reserved predicate's test-to-live ambiguity too.
create or replace function public.integration_key_can_access_event(p_key_id uuid,p_digest text,p_environment text,p_event_id uuid,p_scope text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_environment='live' and exists(select 1 from public.integration_event_grants g join public.events e on e.id=g.event_id
    join public.integrations a on a.id=g.integration_id
    where e.id=p_event_id and e.organiser_id=a.organiser_id and g.organiser_id=a.organiser_id
      and e.status='published' and e.ends_at>now()
      and public.authenticate_integration_key(p_key_id,p_digest,p_environment)->>'integrationId'=a.id::text
      and (public.authenticate_integration_key(p_key_id,p_digest,p_environment)->'scopes') ? p_scope);
$$;

create index integration_events_catalogue_idx on public.events(organiser_id,starts_at,id) where status='published';
create index integration_reservation_expiry_idx on public.reservations(ticket_type_id,expires_at)
  where released_at is null and converted_at is null;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('require_integration_event_reader','integration_event_projection',
      'integration_ticket_snapshot','read_integration_events') loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
    execute 'grant execute on function '||f.signature||' to service_role';
  end loop;
end $$;
