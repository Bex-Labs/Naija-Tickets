-- Phase 3: one hosted session -> at most one existing order. No second ledger.
alter table public.integration_api_keys drop constraint integration_api_keys_scopes_check;
alter table public.integration_api_keys add constraint integration_api_keys_scopes_check check (
 scopes <@ array['integration:read','events:read','tickets:read','availability:read','checkout:write','orders:read']::text[]
 and cardinality(scopes)<=6 and array_position(scopes,null) is null);
alter table public.integration_request_logs drop constraint integration_request_logs_route_check;
alter table public.integration_request_logs add constraint integration_request_logs_route_check check (
 route in ('integration.introspect','api.not_found','events.list','events.detail','events.tickets','events.availability','checkout.create','checkout.status'));

create table public.integration_resource_settings (
 singleton boolean primary key default true check(singleton),
 environment text not null default 'live' check(environment in ('live','test')),
 project_ref text,live_project_ref text,
 check(environment='live' or (project_ref ~ '^[a-z0-9]{20}$' and live_project_ref ~ '^[a-z0-9]{20}$'
   and project_ref is not null and live_project_ref is not null and project_ref<>live_project_ref))
);
insert into public.integration_resource_settings(singleton) values(true);
alter table public.integration_resource_settings enable row level security;
revoke all on public.integration_resource_settings from public,anon,authenticated;
grant all on public.integration_resource_settings to service_role;

create table public.integration_checkout_sessions (
 id uuid primary key,
 integration_id uuid not null,organiser_id uuid not null,
 key_id uuid not null references public.integration_api_keys(id),
 environment text not null check(environment in ('live','test')),
 event_id uuid not null references public.events(id),
 intent jsonb not null check(jsonb_typeof(intent)='array' and jsonb_array_length(intent) between 1 and 20),
 promo_code text check(promo_code ~ '^[A-Z0-9_-]{3,32}$'),
 return_url text not null check(char_length(return_url)<=2048),cancel_url text not null check(char_length(cancel_url)<=2048),
 idempotency_digest text not null check(idempotency_digest ~ '^[a-f0-9]{64}$'),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 capability_hash text not null check(capability_hash ~ '^[a-f0-9]{64}$'),
 reservation_token_hash text not null check(reservation_token_hash ~ '^[a-f0-9]{64}$'),
 signing_key_version text not null check(signing_key_version ~ '^[A-Za-z0-9_-]{1,32}$'),
 reservation_payload_hash text check(reservation_payload_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),expires_at timestamptz not null check(expires_at>created_at),
 order_id uuid unique references public.orders(id),
 foreign key(integration_id,organiser_id) references public.integrations(id,organiser_id),
 unique(integration_id,environment,idempotency_digest)
);
alter table public.integration_checkout_sessions enable row level security;
revoke all on public.integration_checkout_sessions from public,anon,authenticated;
grant all on public.integration_checkout_sessions to service_role;
create index integration_checkout_expiry_idx on public.integration_checkout_sessions(integration_id,expires_at);
alter table public.orders add column integration_checkout_session_id uuid unique references public.integration_checkout_sessions(id);

-- Row-persisted provider initialization lease survives serverless worker changes.
alter table public.payments add column initialize_lease_id uuid,add column initialize_lease_expires_at timestamptz;

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
    or p_scopes is null or not(p_scopes <@ array['integration:read','events:read','tickets:read','availability:read','checkout:write','orders:read']::text[]) or cardinality(p_scopes)>6
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


create function public.get_integration_resource_settings() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('environment',environment,'project_ref',project_ref,'live_project_ref',live_project_ref)
 from public.integration_resource_settings where singleton;
$$;
create function public.require_integration_resource_mode(p_environment text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if (select environment from public.integration_resource_settings where singleton) is distinct from p_environment then
  raise exception 'Resource environment not configured.' using errcode='NT503'; end if;
end; $$;
create or replace function public.require_integration_event_reader(p_key_id uuid,p_digest text,p_environment text,p_scope text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare identity jsonb;
begin
 identity:=public.authenticate_integration_key(p_key_id,p_digest,p_environment);
 if identity is null then raise exception 'Invalid API key.' using errcode='NT401'; end if;
 if not ((identity->'scopes')?p_scope) then raise exception 'Insufficient scope.' using errcode='NT403'; end if;
 perform public.require_integration_resource_mode(p_environment);
 return identity;
end; $$;
create or replace function public.integration_key_can_access_event(p_key_id uuid,p_digest text,p_environment text,p_event_id uuid,p_scope text)
returns boolean language sql stable security definer set search_path='' as $$
 select (select environment=p_environment from public.integration_resource_settings where singleton) and
 exists(select 1 from public.integration_event_grants g join public.events e on e.id=g.event_id
 join public.integrations a on a.id=g.integration_id where e.id=p_event_id and e.organiser_id=a.organiser_id
 and g.organiser_id=a.organiser_id and e.status='published' and e.ends_at>now()
 and public.authenticate_integration_key(p_key_id,p_digest,p_environment)->>'integrationId'=a.id::text
 and (public.authenticate_integration_key(p_key_id,p_digest,p_environment)->'scopes')?p_scope);
$$;

alter table public.integration_checkout_sessions add column cancelled_at timestamptz;
create function public.integration_return_allowed(p_integration_id uuid,p_environment text,p_url text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_url is not null and char_length(p_url)<=2048 and p_url !~ '[[:space:][:cntrl:]\\?#]'
 and exists(select 1 from public.integration_domains d where d.integration_id=p_integration_id and d.environment=p_environment
 and starts_with(p_url,d.origin||'/'));
$$;
create function public.integration_checkout_snapshot(p_session_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'integration_id',s.integration_id,'event_id',s.event_id,'environment',s.environment,
 'expires_at',s.expires_at,'reservation_expires_at',o.reservation_expires_at,'signing_key_version',s.signing_key_version,'capability_hash',s.capability_hash,
 'status',case
   when o.status in ('paid','refunded','partially_refunded') and exists(select 1 from public.payments p where p.order_id=o.id and p.status='verified') then o.status::text
   when s.cancelled_at is not null then 'cancelled'
   when s.expires_at<=now() or o.status='expired' or (o.status='pending' and o.reservation_expires_at<=now()) then 'expired'
   when o.status in ('failed','abandoned') then 'failed'
   when o.id is null then 'open'
   when exists(select 1 from public.payments p where p.order_id=o.id and p.status in ('initialized','pending')) then 'pending'
   when exists(select 1 from public.payments p where p.order_id=o.id and p.status in ('failed','abandoned')) then 'failed'
   else 'reserved' end,
 'currency',coalesce(o.currency::text,'NGN'),
 'admissions',case when o.id is not null then (select coalesce(sum(i.quantity*i.admissions_per_ticket),0) from public.order_items i where i.order_id=o.id)
   else (select coalesce(sum((i->>'quantity')::integer*t.admissions_per_ticket),0) from jsonb_array_elements(s.intent) i join public.ticket_types t on t.id=(i->>'ticket_type_id')::uuid) end,
 'subtotal_kobo',o.subtotal_kobo,'discount_kobo',o.discount_kobo,'fee_kobo',o.fee_kobo,'total_kobo',o.total_kobo,
 'tickets_issued',(select count(*) from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=o.id and t.claim_state<>'UNCLAIMED'),
 'members_registered',(select count(*) from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=o.id and t.group_booking_id is not null and t.claim_state<>'UNCLAIMED'))
 from public.integration_checkout_sessions s left join public.orders o on o.id=s.order_id where s.id=p_session_id;
$$;

create function public.create_integration_checkout_session(
 p_key_id uuid,p_digest text,p_environment text,p_session_id uuid,p_event_id uuid,p_items jsonb,p_promo_code text,
 p_return_url text,p_cancel_url text,p_idempotency_digest text,p_payload_hash text,p_capability_hash text,p_reservation_hash text,
 p_signing_version text,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb; existing public.integration_checkout_sessions%rowtype; item jsonb; tier public.ticket_types%rowtype;
 total_admissions integer:=0; seen uuid[]:='{}'; qty integer;
begin
 identity:=public.require_integration_event_reader(p_key_id,p_digest,p_environment,'checkout:write');
 -- Serialize application/session creation, including an absent idempotency row.
 perform 1 from public.integrations where id=(identity->>'integrationId')::uuid for update;
 perform 1 from public.integration_api_keys where id=p_key_id for share;
 identity:=public.require_integration_event_reader(p_key_id,p_digest,p_environment,'checkout:write');
 if not public.integration_return_allowed((identity->>'integrationId')::uuid,p_environment,p_return_url)
 or not public.integration_return_allowed((identity->>'integrationId')::uuid,p_environment,p_cancel_url) then
  raise exception 'Return URL not registered.' using errcode='NT400'; end if;
 if p_idempotency_digest !~ '^[a-f0-9]{64}$' or p_payload_hash !~ '^[a-f0-9]{64}$' or p_capability_hash !~ '^[a-f0-9]{64}$'
 or p_reservation_hash !~ '^[a-f0-9]{64}$' or p_signing_version !~ '^[A-Za-z0-9_-]{1,32}$'
 or p_expires_at<=now() or p_expires_at>now()+interval '31 minutes' or p_expires_at>(identity->>'expiresAt')::timestamptz
 or p_expires_at is null or p_idempotency_digest is null or p_payload_hash is null or p_capability_hash is null
 or p_reservation_hash is null or p_signing_version is null then raise exception 'Invalid session configuration.' using errcode='NT400'; end if;
 select * into existing from public.integration_checkout_sessions where integration_id=(identity->>'integrationId')::uuid
 and environment=p_environment and idempotency_digest=p_idempotency_digest for update;
 if found then
  if existing.payload_hash<>p_payload_hash then raise exception 'Idempotency payload conflict.' using errcode='NT409'; end if;
  return public.integration_checkout_snapshot(existing.id);
 end if;
 if (select count(*) from public.integration_checkout_sessions where integration_id=(identity->>'integrationId')::uuid and expires_at>now())>=1000 then
  raise exception 'Too many active checkout sessions.' using errcode='NT409'; end if;
 if not public.integration_key_can_access_event(p_key_id,p_digest,p_environment,p_event_id,'checkout:write') then
  raise exception 'Event not found.' using errcode='NT404'; end if;
 if exists(select 1 from public.events where id=p_event_id and
 ((sales_start_at is not null and sales_start_at>now()) or (sales_end_at is not null and sales_end_at<=now()))) then
  raise exception 'Event sales unavailable.' using errcode='NT409'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then
  raise exception 'Invalid ticket selection.' using errcode='NT400'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
  or not(item?'ticket_type_id' and item?'quantity') or (item->>'quantity') !~ '^[1-9][0-9]?$' then
   raise exception 'Invalid ticket selection.' using errcode='NT400'; end if;
  select * into tier from public.ticket_types where id=(item->>'ticket_type_id')::uuid and event_id=p_event_id and active;
  qty:=(item->>'quantity')::integer;
  if not found or tier.id=any(seen) or qty not between tier.min_per_order and least(tier.max_per_order,20)
   or (tier.sales_start_at is not null and tier.sales_start_at>now()) or (tier.sales_end_at is not null and tier.sales_end_at<=now()) then
   raise exception 'Selected tickets unavailable.' using errcode='NT409'; end if;
  total_admissions:=total_admissions+qty*tier.admissions_per_ticket; seen:=array_append(seen,tier.id);
 end loop;
 if total_admissions>400 then raise exception 'Too many admissions.' using errcode='NT400'; end if;
 insert into public.integration_checkout_sessions(id,integration_id,organiser_id,key_id,environment,event_id,intent,promo_code,
 return_url,cancel_url,idempotency_digest,payload_hash,capability_hash,reservation_token_hash,signing_key_version,expires_at)
 values(p_session_id,(identity->>'integrationId')::uuid,(identity->>'organiserId')::uuid,p_key_id,p_environment,p_event_id,p_items,p_promo_code,
 p_return_url,p_cancel_url,p_idempotency_digest,p_payload_hash,p_capability_hash,p_reservation_hash,p_signing_version,p_expires_at);
 return public.integration_checkout_snapshot(p_session_id);
end; $$;

create function public.get_integration_checkout_session(p_key_id uuid,p_digest text,p_environment text,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare identity jsonb; session public.integration_checkout_sessions%rowtype;
begin
 identity:=public.require_integration_event_reader(p_key_id,p_digest,p_environment,'orders:read');
 select s.* into session from public.integration_checkout_sessions s join public.events e on e.id=s.event_id
 join public.integration_event_grants g on g.event_id=e.id and g.integration_id=s.integration_id and g.organiser_id=e.organiser_id
 where s.id=p_session_id and s.integration_id=(identity->>'integrationId')::uuid and s.environment=p_environment
 and s.organiser_id=(identity->>'organiserId')::uuid and e.organiser_id=s.organiser_id;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 return public.integration_checkout_snapshot(session.id);
end; $$;

-- Validate the original issuing key, app and grant for a new unpaid action.
-- Payment callbacks still finalize already authorized provider payments.
create function public.require_hosted_checkout_active(p_session_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare session public.integration_checkout_sessions%rowtype; identity jsonb; key_digest text;
begin
 select * into session from public.integration_checkout_sessions where id=p_session_id;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 perform public.require_integration_resource_mode(session.environment);
 perform 1 from public.integrations where id=session.integration_id for share;
 select credential_digest into key_digest from public.integration_api_keys where id=session.key_id for share;
 identity:=public.authenticate_integration_key(session.key_id,key_digest,session.environment);
 if identity is null or not((identity->'scopes')?'checkout:write') then raise exception 'Checkout disabled.' using errcode='NT403'; end if;
 if not exists(select 1 from public.integration_event_grants g join public.events e on e.id=g.event_id
 where g.integration_id=session.integration_id and g.event_id=session.event_id and e.organiser_id=session.organiser_id
 and g.organiser_id=session.organiser_id) then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 if session.cancelled_at is not null or session.expires_at<=now() then raise exception 'Checkout expired.' using errcode='NT410'; end if;
end; $$;

create function public.get_hosted_checkout(p_session_id uuid,p_access_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare session public.integration_checkout_sessions%rowtype; booking public.orders%rowtype; result jsonb;
begin
 select * into session from public.integration_checkout_sessions where id=p_session_id and capability_hash=p_access_hash;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 perform public.require_integration_resource_mode(session.environment);
 if session.expires_at<=now() then raise exception 'Checkout expired.' using errcode='NT410'; end if;
 select * into booking from public.orders where id=session.order_id;
 if booking.id is null or booking.status not in ('paid','refunded','partially_refunded') then
  -- Stable reads recheck active issuer without attempting row locks.
  if not exists(select 1 from public.integration_api_keys k join public.integrations a on a.id=k.integration_id
   join public.integration_event_grants g on g.integration_id=a.id and g.event_id=session.event_id
   join public.events e on e.id=g.event_id and e.organiser_id=a.organiser_id
   where k.id=session.key_id and k.revoked_at is null and k.expires_at>now() and a.status='active'
   and 'checkout:write'=any(k.scopes) and public.integration_manager(k.created_by,a.organiser_id)
   and g.organiser_id=a.organiser_id and session.cancelled_at is null) then
    raise exception 'Checkout disabled.' using errcode='NT403'; end if;
 end if;
 select jsonb_build_object('session',public.integration_checkout_snapshot(session.id),'promo_code',session.promo_code,
 'event',public.integration_event_projection(e),'intent',session.intent,
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('ticketTypeId',t.id,'name',t.name,'quantity',(i->>'quantity')::integer,
   'admissionsPerTicket',coalesce(oi.admissions_per_ticket,t.admissions_per_ticket),
   'unitPriceKobo',coalesce(oi.unit_price_kobo,(ts.ticket->>'price_kobo')::bigint),
   'lineTotalKobo',coalesce(oi.line_total_kobo,(i->>'quantity')::integer*(ts.ticket->>'price_kobo')::bigint)) order by t.sort_order,t.id),'[]'::jsonb)
   from jsonb_array_elements(session.intent) i join public.ticket_types t on t.id=(i->>'ticket_type_id')::uuid
   left join public.integration_ticket_snapshot(session.event_id) ts on ts.id=t.id
   left join public.order_items oi on oi.order_id=session.order_id and oi.ticket_type_id=t.id),
 'reservation',case when booking.id is null then null else jsonb_build_object('orderId',booking.id,'reference',booking.reference,
   'expiresAt',booking.reservation_expires_at,'subtotalKobo',booking.subtotal_kobo,'discountKobo',booking.discount_kobo,
   'feeKobo',booking.fee_kobo,'totalKobo',booking.total_kobo,'promoCode',(select code from public.promo_codes where id=booking.promo_code_id)) end)
 into result from public.events e where e.id=session.event_id and e.organiser_id=session.organiser_id;
 return result;
end; $$;

create function public.reserve_hosted_checkout(
 p_session_id uuid,p_access_hash text,p_customer_id uuid,p_items jsonb,p_purchaser jsonb,p_promo_code text,p_reservation_payload_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare session public.integration_checkout_sessions%rowtype; booking public.orders%rowtype; created record; normalized jsonb;
begin
 select * into session from public.integration_checkout_sessions where id=p_session_id and capability_hash=p_access_hash;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 perform public.lock_event_checkout_inventory(session.event_id);
 perform public.require_hosted_checkout_active(session.id);
 select * into session from public.integration_checkout_sessions where id=p_session_id for update;
 if p_reservation_payload_hash is null or p_reservation_payload_hash !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid reservation.' using errcode='NT400'; end if;
 if session.order_id is not null then
  if session.reservation_payload_hash<>p_reservation_payload_hash then raise exception 'Reservation payload conflict.' using errcode='NT409'; end if;
  return public.get_hosted_checkout(session.id,p_access_hash)->'reservation';
 end if;
 select jsonb_agg(jsonb_build_object('ticket_type_id',i->>'ticket_type_id','quantity',(i->>'quantity')::integer) order by i->>'ticket_type_id')
 into normalized from jsonb_array_elements(p_items) i;
 if normalized is distinct from session.intent then raise exception 'Selection cannot change.' using errcode='NT409'; end if;
 if session.promo_code is not null and session.promo_code is distinct from p_promo_code then raise exception 'Promo cannot change.' using errcode='NT409'; end if;
 select * into created from public.create_checkout_reservation_v3(p_customer_id,session.event_id,p_items,p_purchaser,session.reservation_token_hash,p_promo_code);
 if created.total_kobo>9007199254740991 then raise exception 'Order total is too large.' using errcode='NT409'; end if;
 update public.orders set integration_checkout_session_id=session.id,reservation_expires_at=least(reservation_expires_at,session.expires_at) where id=created.order_id;
 update public.reservations set expires_at=least(expires_at,session.expires_at) where order_item_id in(select id from public.order_items where order_id=created.order_id);
 update public.integration_checkout_sessions set order_id=created.order_id,reservation_payload_hash=p_reservation_payload_hash where id=session.id;
 return public.get_hosted_checkout(session.id,p_access_hash)->'reservation';
end; $$;

create function public.integration_checkout_return(p_order_id uuid,p_cancel boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare session public.integration_checkout_sessions%rowtype; snapshot jsonb; destination text;
begin
 select * into session from public.integration_checkout_sessions where order_id=p_order_id;
 if not found then return null; end if;
 snapshot:=public.integration_checkout_snapshot(session.id);
 destination:=case when p_cancel then session.cancel_url else session.return_url end;
 if not public.integration_return_allowed(session.integration_id,session.environment,destination) then return null; end if;
 return jsonb_build_object('session_id',session.id,'status',snapshot->>'status','url',destination);
end; $$;

-- Serialize stock-changing entry points per event, before any order/payment/tier
-- lock. Release/issue/prepare/finalize use the same lock as reservations.
create function public.lock_event_checkout_inventory(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_event_id is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nt.inventory.'||p_event_id::text,0)); end if;
end; $$;
-- The sole base engine is unchanged except that it cleans this event's expired
-- holds, rather than locking every tenant's reservations on each checkout.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.create_checkout_reservation(uuid,uuid,jsonb,integer,jsonb,text)'::regprocedure);
 if position('where reservation.expires_at <= now()' in definition)=0 then raise exception 'Unexpected reservation definition.'; end if;
 definition:=replace(definition,'where reservation.expires_at <= now()',
   'where reservation.expires_at <= now() and order_item.order_id in (select id from public.orders where event_id = p_event_id)');
 execute definition;
end $$;

alter function public.create_checkout_reservation_v3(uuid,uuid,jsonb,jsonb,text,text) rename to create_checkout_reservation_v3_pre_hosted;
create function public.create_checkout_reservation_v3(p_customer_id uuid,p_event_id uuid,p_items jsonb,p_purchaser jsonb,p_checkout_token_hash text,p_promo_code text default null)
returns table(order_id uuid,reference text,expires_at timestamptz,subtotal_kobo bigint,fee_kobo bigint,total_kobo bigint,discount_kobo bigint,promo_code text)
language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_event_checkout_inventory(p_event_id);
 perform 1 from public.events where id=p_event_id for share;
 if not exists(select 1 from public.events where id=p_event_id and status='published' and ends_at>now()
   and (sales_start_at is null or sales_start_at<=now()) and (sales_end_at is null or sales_end_at>now())) then
   raise exception 'Event sales are not available.'; end if;
 return query select * from public.create_checkout_reservation_v3_pre_hosted(p_customer_id,p_event_id,p_items,p_purchaser,p_checkout_token_hash,p_promo_code);
end; $$;

alter function public.release_checkout_order(uuid) rename to release_checkout_order_pre_hosted;
create function public.release_checkout_order(p_order_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_event_checkout_inventory((select event_id from public.orders where id=p_order_id));
 perform public.release_checkout_order_pre_hosted(p_order_id);
end; $$;
alter function public.issue_checkout_tickets(uuid) rename to issue_checkout_tickets_pre_hosted;
create function public.issue_checkout_tickets(p_order_id uuid) returns integer language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_event_checkout_inventory((select event_id from public.orders where id=p_order_id));
 return public.issue_checkout_tickets_pre_hosted(p_order_id);
end; $$;
alter function public.prepare_paystack_payment(uuid,text) rename to prepare_paystack_payment_pre_hosted;
create function public.prepare_paystack_payment(p_order_id uuid,p_checkout_token_hash text)
returns table(outcome text,order_id uuid,order_reference text,payment_reference text,amount_kobo bigint,currency text,expires_at timestamptz,authorization_url text,purchaser_email text)
language plpgsql security definer set search_path='' as $$
declare booking public.orders%rowtype; attempt public.payments%rowtype;
begin
 select * into booking from public.orders where id=p_order_id and checkout_token_hash=p_checkout_token_hash;
 if found then
  perform public.lock_event_checkout_inventory(booking.event_id);
  select * into booking from public.orders where id=p_order_id and checkout_token_hash=p_checkout_token_hash;
  if booking.integration_checkout_session_id is not null and booking.status not in ('paid','refunded','partially_refunded') then
   perform public.require_hosted_checkout_active(booking.integration_checkout_session_id);
   select * into attempt from public.payments where public.payments.order_id=booking.id and provider='paystack' order by created_at desc,id desc limit 1;
   if attempt.status in ('failed','abandoned') then
    -- A hosted intent cannot silently authorize a second charge reference.
    return query select 'failed',booking.id,booking.reference,attempt.provider_reference,booking.total_kobo,booking.currency::text,booking.reservation_expires_at,null::text,booking.purchaser_email;
    return;
   end if;
  end if;
 end if;
 return query select * from public.prepare_paystack_payment_pre_hosted(p_order_id,p_checkout_token_hash);
end; $$;
alter function public.complete_free_checkout(uuid,text) rename to complete_free_checkout_pre_hosted;
create function public.complete_free_checkout(p_order_id uuid,p_checkout_token_hash text)
returns table(outcome text,order_reference text,ticket_count integer)
language plpgsql security definer set search_path='' as $$
declare booking public.orders%rowtype;
begin
 select * into booking from public.orders where id=p_order_id and checkout_token_hash=p_checkout_token_hash;
 if found then
  perform public.lock_event_checkout_inventory(booking.event_id);
  select * into booking from public.orders where id=p_order_id and checkout_token_hash=p_checkout_token_hash;
  if booking.integration_checkout_session_id is not null and booking.status not in ('paid','refunded','partially_refunded') then
   perform public.require_hosted_checkout_active(booking.integration_checkout_session_id); end if;
 end if;
 return query select * from public.complete_free_checkout_pre_hosted(p_order_id,p_checkout_token_hash);
end; $$;
alter function public.finalize_paystack_payment(text,text,bigint,text,text,jsonb,text,text,text) rename to finalize_paystack_payment_pre_hosted;
create function public.finalize_paystack_payment(p_provider_reference text,p_provider_status text,p_amount_kobo bigint,p_currency text,p_provider_transaction_id text,p_payload jsonb,p_provider_event_id text default null,p_event_type text default null,p_payload_hash text default null)
returns table(outcome text,order_id uuid,order_reference text,ticket_count integer)
language plpgsql security definer set search_path='' as $$
declare booking public.orders%rowtype; payment public.payments%rowtype;
begin
 select o.* into booking from public.orders o join public.payments p on p.order_id=o.id where p.provider='paystack' and p.provider_reference=p_provider_reference;
 perform public.lock_event_checkout_inventory(booking.event_id);
 select * into booking from public.orders where id=booking.id;
 select * into payment from public.payments where provider='paystack' and provider_reference=p_provider_reference;
 if payment.status='verified' and booking.status in ('paid','refunded','partially_refunded')
  and (p_provider_status is distinct from 'success' or p_amount_kobo is distinct from payment.amount_kobo or upper(p_currency) is distinct from payment.currency) then
   -- A later failure/mismatched response must never downgrade a committed payment.
   return query select case when p_provider_status='success' then 'amount_or_currency_mismatch' else 'already_paid' end,
    booking.id,booking.reference,(select count(*)::integer from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=booking.id);
   return;
 end if;
 return query select * from public.finalize_paystack_payment_pre_hosted(p_provider_reference,p_provider_status,p_amount_kobo,p_currency,p_provider_transaction_id,p_payload,p_provider_event_id,p_event_type,p_payload_hash);
end; $$;

create function public.claim_checkout_payment_initialization(p_order_id uuid,p_checkout_token_hash text,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared record; payment public.payments%rowtype;
begin
 select * into prepared from public.prepare_paystack_payment(p_order_id,p_checkout_token_hash);
 if prepared.outcome<>'ready' or prepared.authorization_url is not null then return to_jsonb(prepared); end if;
 select * into payment from public.payments where provider='paystack' and provider_reference=prepared.payment_reference for update;
 if payment.initialize_lease_expires_at>now() and payment.initialize_lease_id is distinct from p_lease_id then
  return to_jsonb(prepared)||jsonb_build_object('outcome','initialization_busy'); end if;
 update public.payments set initialize_lease_id=p_lease_id,initialize_lease_expires_at=now()+interval '45 seconds' where id=payment.id;
 return to_jsonb(prepared);
end; $$;
create function public.finish_checkout_payment_initialization(p_reference text,p_lease_id uuid,p_authorization_url text,p_access_code text,p_response jsonb,p_subaccount_code text default null,p_transaction_charge_kobo bigint default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_authorization_url not like 'https://checkout.paystack.com/%' or p_access_code is null then
  raise exception 'Invalid payment response.' using errcode='22023'; end if;
 update public.payments set status='pending',authorization_url=p_authorization_url,access_code=p_access_code,initialization_response=p_response,
 provider_status='initialized',updated_at=now(),provider_subaccount_code=p_subaccount_code,
 platform_transaction_charge_kobo=p_transaction_charge_kobo,initialize_lease_id=null,initialize_lease_expires_at=null
 where provider='paystack' and provider_reference=p_reference and initialize_lease_id=p_lease_id and initialize_lease_expires_at>now() and status in ('initialized','pending');
 get diagnostics changed=row_count; return changed=1;
end; $$;

create function public.cancel_hosted_checkout(p_session_id uuid,p_access_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare session public.integration_checkout_sessions%rowtype; destination text; booking public.orders%rowtype;
begin
 select * into session from public.integration_checkout_sessions where id=p_session_id and capability_hash=p_access_hash;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 perform public.require_integration_resource_mode(session.environment);
 if session.expires_at<=now() then raise exception 'Checkout expired.' using errcode='NT410'; end if;
 perform public.lock_event_checkout_inventory(session.event_id);
 select * into session from public.integration_checkout_sessions where id=p_session_id for update;
 select * into booking from public.orders where id=session.order_id;
 if booking.status in ('paid','refunded','partially_refunded') then
  return public.integration_checkout_return(booking.id,false); end if;
 if session.order_id is not null then perform public.release_checkout_order(session.order_id); end if;
 update public.integration_checkout_sessions set cancelled_at=coalesce(cancelled_at,now()) where id=session.id;
 destination:=case when public.integration_return_allowed(session.integration_id,session.environment,session.cancel_url) then session.cancel_url else null end;
 return jsonb_build_object('url',destination,'session_id',session.id,'status','cancelled');
end; $$;

-- Older preparation/issuance implementations remain internal only. New wrappers
-- preserve public signatures and existing response contracts.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and (p.proname like '%_pre_hosted' or p.proname in ('get_integration_resource_settings','require_integration_resource_mode',
  'integration_return_allowed','integration_checkout_snapshot','create_integration_checkout_session','get_integration_checkout_session',
  'require_hosted_checkout_active','get_hosted_checkout','reserve_hosted_checkout','integration_checkout_return',
  'lock_event_checkout_inventory','claim_checkout_payment_initialization','finish_checkout_payment_initialization','cancel_hosted_checkout',
  'create_checkout_reservation_v3','release_checkout_order','issue_checkout_tickets','prepare_paystack_payment','complete_free_checkout','finalize_paystack_payment')) loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
  if f.name not like '%_pre_hosted' then execute 'grant execute on function '||f.signature||' to service_role'; end if;
 end loop;
end $$;

-- A distinct guest/session budget cannot consume the application's API bucket.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.consume_integration_rate_limit(text,integer,integer)'::regprocedure);
 if position('(key|integration|organiser|dashboard)' in definition)=0 then raise exception 'Unexpected rate-limit definition.'; end if;
 execute replace(definition,'(key|integration|organiser|dashboard)','(key|integration|organiser|dashboard|checkout)');
end $$;
