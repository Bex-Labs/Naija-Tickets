-- Externally managed events use the existing event, inventory, order, payment,
-- ticket and entry records. They are private backing records for one integration.
alter table public.events add column external_managed boolean not null default false;
-- The backing event is deliberately not browseable through the marketplace or
-- PostgREST. Its verified checkout is reached only through its owning
-- application/widget, while organisers and administrators retain oversight.
alter policy events_public_read on public.events using (
  (status = 'published' and ends_at > now() and not external_managed)
  or public.is_organiser_member(organiser_id)
  or public.has_role('administrator')
);
alter policy ticket_types_visible on public.ticket_types using (
  exists (
    select 1 from public.events e
    where e.id = event_id and (
      (e.status = 'published' and e.ends_at > now() and not e.external_managed)
      or public.is_organiser_member(e.organiser_id)
      or public.has_role('administrator')
    )
  )
);
create table public.integration_external_events (
  integration_id uuid not null references public.integrations(id),
  external_id text not null check (external_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  event_id uuid not null unique references public.events(id) on delete cascade,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (integration_id, external_id)
);
create table public.integration_external_ticket_types (
  integration_id uuid not null,
  external_event_id text not null,
  external_id text not null check (external_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  ticket_type_id uuid not null unique references public.ticket_types(id) on delete cascade,
  primary key (integration_id, external_event_id, external_id),
  foreign key (integration_id, external_event_id)
    references public.integration_external_events(integration_id, external_id) on delete cascade
);
alter table public.integration_external_events enable row level security;
alter table public.integration_external_ticket_types enable row level security;
revoke all on public.integration_external_events, public.integration_external_ticket_types from public, anon, authenticated;
grant all on public.integration_external_events, public.integration_external_ticket_types to service_role;

alter table public.integration_api_keys drop constraint integration_api_keys_scopes_check;
alter table public.integration_api_keys add constraint integration_api_keys_scopes_check check (
 scopes <@ array['integration:read','events:read','tickets:read','availability:read','checkout:write','external_events:write','orders:read','tickets:status','attendees:read','attendees:contact','sales:read','groups:read','refunds:read','entry:verify','entry:check-in']::text[]
 and cardinality(scopes)<=15 and array_position(scopes,null) is null);
alter table public.integration_request_logs drop constraint integration_request_logs_route_check;
alter table public.integration_request_logs add constraint integration_request_logs_route_check check (
 route in ('integration.introspect','api.not_found','events.list','events.detail','events.tickets','events.availability',
 'checkout.create','checkout.status','external_events.upsert','advanced.orders','advanced.order','advanced.tickets',
 'advanced.ticket','advanced.attendees','advanced.groups','advanced.refunds','advanced.sales','advanced.entry'));

-- This is the existing key-issuance procedure with one additional opt-in
-- scope. New functionality never appears on an older key automatically.
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
    or p_scopes is null or not(p_scopes <@ array['integration:read','events:read','tickets:read','availability:read','checkout:write','external_events:write','orders:read','tickets:status','attendees:read','attendees:contact','sales:read','groups:read','refunds:read','entry:verify','entry:check-in']::text[]) or cardinality(p_scopes)>15
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

create function public.upsert_integration_external_event(
 p_key_id uuid,p_digest text,p_environment text,p_external_id text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare auth jsonb; app public.integrations%rowtype; saved public.integration_external_events%rowtype;
 category uuid; item jsonb; ticket public.ticket_types%rowtype; created_event_id uuid;
 v_title text; v_starts_at timestamptz; v_ends_at timestamptz; v_sales_start timestamptz; v_sales_end timestamptz;
 package_count integer; admitted integer; price bigint; external_ticket text; minimum integer; maximum integer;
begin
 auth:=public.authenticate_integration_key(p_key_id,p_digest,p_environment);
 if auth is null or not (auth->'scopes' ? 'external_events:write') then
  raise exception 'External event access is not authorised.' using errcode='42501'; end if;
 if p_external_id is null or p_external_id !~ '^[A-Za-z0-9_.:-]{1,100}$'
   or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid external event.' using errcode='22023'; end if;
 v_title:=trim(coalesce(p_payload->>'title',''));
 if char_length(v_title) not between 2 and 160 or jsonb_typeof(p_payload->'tickets') is distinct from 'array'
    or jsonb_array_length(p_payload->'tickets') not between 1 and 20 then
  raise exception 'Enter an event title and one to twenty ticket types.' using errcode='22023'; end if;
 begin v_starts_at:=(p_payload->>'starts_at')::timestamptz; v_ends_at:=(p_payload->>'ends_at')::timestamptz; exception when others then
  raise exception 'Use valid event start and end dates.' using errcode='22023'; end;
 if v_ends_at<=v_starts_at then raise exception 'The event end must be after its start.' using errcode='22023'; end if;
 begin
  v_sales_start:=coalesce(nullif(p_payload->>'sales_start_at','')::timestamptz,now());
  v_sales_end:=coalesce(nullif(p_payload->>'sales_end_at','')::timestamptz,v_ends_at);
 exception when others then raise exception 'Use valid ticket sales dates.' using errcode='22023'; end;
 if v_sales_end<=v_sales_start then raise exception 'The sales end must be after sales start.' using errcode='22023'; end if;
 if exists(
   select 1 from (
     select value->>'external_id' as external_id,count(*)
     from jsonb_array_elements(p_payload->'tickets') value
     group by value->>'external_id' having count(*)>1
   ) duplicate_ticket
 ) then raise exception 'Each external ticket needs a different ID.' using errcode='22023'; end if;
 select * into app from public.integrations where id=(auth->>'integrationId')::uuid and status='active' for update;
 if not found then raise exception 'Integration not found.' using errcode='P0002'; end if;
 select id into category from public.categories where active order by sort_order,id limit 1;
 if category is null then raise exception 'A ticket category is required before external events can be added.' using errcode='NT503'; end if;
 select * into saved from public.integration_external_events where integration_id=app.id and external_id=p_external_id for update;
 if not found then
  insert into public.events(organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,timezone,starts_at,ends_at,sales_start_at,sales_end_at,status,image_path,external_managed)
  values(app.organiser_id,category,v_title,'external-'||substr(replace(gen_random_uuid()::text,'-',''),1,24),
   left(coalesce(nullif(trim(p_payload->>'presenter_line'),''),v_title||' presents'),160),
   left(coalesce(nullif(trim(p_payload->>'description'),''),'Tickets sold by the event organiser.'),2000),
   left(coalesce(nullif(trim(p_payload->>'venue_name'),''),'External venue'),160),
   left(coalesce(nullif(trim(p_payload->>'address'),''),'See organiser website'),300),
   left(coalesce(nullif(trim(p_payload->>'city'),''),'Online'),80),left(coalesce(nullif(trim(p_payload->>'state'),''),'Online'),80),
   coalesce(nullif(trim(p_payload->>'timezone'),''),'Africa/Lagos'),v_starts_at,v_ends_at,v_sales_start,v_sales_end,'published',nullif(trim(p_payload->>'image_url'),''),true) returning id into created_event_id;
  insert into public.integration_external_events(integration_id,external_id,event_id,source_url)
   values(app.id,p_external_id,created_event_id,nullif(trim(p_payload->>'source_url'),'')) returning * into saved;
  insert into public.integration_event_grants(integration_id,organiser_id,event_id) values(app.id,app.organiser_id,saved.event_id) on conflict do nothing;
 else
  update public.events set title=v_title,presenter_line=left(coalesce(nullif(trim(p_payload->>'presenter_line'),''),v_title||' presents'),160),description=left(coalesce(nullif(trim(p_payload->>'description'),''),'Tickets sold by the event organiser.'),2000),
   venue_name=left(coalesce(nullif(trim(p_payload->>'venue_name'),''),'External venue'),160),address=left(coalesce(nullif(trim(p_payload->>'address'),''),'See organiser website'),300),
   city=left(coalesce(nullif(trim(p_payload->>'city'),''),'Online'),80),state=left(coalesce(nullif(trim(p_payload->>'state'),''),'Online'),80),
   timezone=coalesce(nullif(trim(p_payload->>'timezone'),''),'Africa/Lagos'),starts_at=v_starts_at,ends_at=v_ends_at,sales_start_at=v_sales_start,sales_end_at=v_sales_end,status='published',external_managed=true,image_path=nullif(trim(p_payload->>'image_url'),''),updated_at=now() where id=saved.event_id;
  update public.integration_external_events set source_url=nullif(trim(p_payload->>'source_url'),''),updated_at=now() where integration_id=app.id and external_id=p_external_id;
 end if;
 for item in select value from jsonb_array_elements(p_payload->'tickets') loop
  external_ticket:=item->>'external_id';
  if external_ticket is null or external_ticket !~ '^[A-Za-z0-9_.:-]{1,100}$' or char_length(trim(coalesce(item->>'name',''))) not between 2 and 120 then
   raise exception 'Every external ticket needs an ID and name.' using errcode='22023'; end if;
  begin price:=(item->>'price_kobo')::bigint; package_count:=(item->>'quantity')::integer; admitted:=coalesce((item->>'admissions_per_ticket')::integer,1); exception when others then
   raise exception 'Use whole-number ticket prices, quantities and admissions.' using errcode='22023'; end;
  begin minimum:=coalesce((item->>'min_per_order')::integer,1); maximum:=coalesce((item->>'max_per_order')::integer,10); exception when others then
   raise exception 'Use whole-number ticket order limits.' using errcode='22023'; end;
  if price<0 or package_count<0 or admitted not between 1 and 100 or package_count>100000
     or minimum not between 1 and 20 or maximum not between minimum and 20 then
   raise exception 'External ticket values are outside the allowed range.' using errcode='22023'; end if;
  select t.* into ticket from public.integration_external_ticket_types x join public.ticket_types t on t.id=x.ticket_type_id
   where x.integration_id=app.id and x.external_event_id=p_external_id and x.external_id=external_ticket for update;
  if found then
   if exists(select 1 from public.order_items where ticket_type_id=ticket.id) and (ticket.standard_price_kobo<>price or ticket.admissions_per_ticket<>admitted) then
    raise exception 'A ticket price or admissions cannot change after it has been ordered.' using errcode='22023'; end if;
   if package_count*admitted < ticket.quantity_sold+ticket.quantity_reserved then
    raise exception 'Ticket quantity cannot be lower than sold or reserved admissions.' using errcode='22023'; end if;
   update public.ticket_types set name=trim(item->>'name'),description=nullif(trim(item->>'description'),''),price_kobo=price,standard_price_kobo=price,
     quantity_total=package_count*admitted,min_per_order=minimum,max_per_order=maximum,
     sales_start_at=v_sales_start,sales_end_at=v_sales_end,active=true where id=ticket.id;
  else
   insert into public.ticket_types(event_id,name,description,price_kobo,standard_price_kobo,quantity_total,admissions_per_ticket,min_per_order,max_per_order,sales_start_at,sales_end_at,active,sort_order)
   values(saved.event_id,trim(item->>'name'),nullif(trim(item->>'description'),''),price,price,package_count*admitted,admitted,minimum,maximum,v_sales_start,v_sales_end,true,0) returning id into created_event_id;
   insert into public.integration_external_ticket_types(integration_id,external_event_id,external_id,ticket_type_id) values(app.id,p_external_id,external_ticket,created_event_id);
  end if;
 end loop;
 update public.ticket_types t set active=false
 where t.event_id=saved.event_id and t.active and exists(
   select 1 from public.integration_external_ticket_types x
   where x.integration_id=app.id and x.external_event_id=p_external_id and x.ticket_type_id=t.id
 ) and not exists(
   select 1 from jsonb_array_elements(p_payload->'tickets') supplied
   where supplied->>'external_id'=(select x.external_id from public.integration_external_ticket_types x where x.ticket_type_id=t.id)
 );
 insert into public.audit_logs(action,entity_type,entity_id,metadata) values('integration.external_event_upserted','integration_external_event',saved.event_id::text,jsonb_build_object('integration_id',app.id,'external_id',p_external_id));
 return jsonb_build_object('id',saved.event_id,'external_id',p_external_id,'title',v_title,'status','published');
end; $$;
revoke all on function public.upsert_integration_external_event(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_integration_external_event(uuid,text,text,text,jsonb) to service_role;
