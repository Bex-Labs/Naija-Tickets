-- Phase 5: public opt-in widget identity, sharing the existing hosted checkout.
create table public.integration_widgets (
 id uuid primary key default gen_random_uuid(), integration_id uuid not null references public.integrations(id),
 environment text not null check(environment in ('test','live')), enabled boolean not null default false,
 checkout_enabled boolean not null default false, revision integer not null default 1,
 managed_by uuid not null references public.profiles(id), unique(integration_id,environment)
);
alter table public.integration_widgets enable row level security;
revoke all on public.integration_widgets from public,anon,authenticated;
grant all on public.integration_widgets to service_role;
alter table public.integration_checkout_sessions alter column key_id drop not null,
 add column widget_configuration_id uuid references public.integration_widgets(id),
 add column widget_revision integer, add column widget_origin text,
 add constraint integration_session_actor check (
   (key_id is not null and widget_configuration_id is null and widget_revision is null and widget_origin is null)
   or (key_id is null and widget_configuration_id is not null and widget_revision is not null and widget_origin is not null)
 );

create function public.manage_integration_widget(p_user uuid,p_app uuid,p_mode text,p_enabled boolean default null,p_checkout boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.integration_widgets%rowtype;
begin
 perform public.require_webhook_manager(p_user,p_app);
 if p_mode not in ('test','live') or p_mode is null or (p_enabled is null)<>(p_checkout is null) then
   raise exception 'Invalid widget configuration.' using errcode='22023'; end if;
 perform 1 from public.integrations where id=p_app for update;
 if p_enabled is not null then
   if not exists(select 1 from public.integration_resource_settings where singleton and environment=p_mode) then
     raise exception 'Resource mode does not match.' using errcode='22023'; end if;
   insert into public.integration_widgets(integration_id,environment,enabled,checkout_enabled,managed_by)
     values(p_app,p_mode,p_enabled,p_checkout,p_user)
   on conflict(integration_id,environment) do update set enabled=excluded.enabled,checkout_enabled=excluded.checkout_enabled,
     managed_by=p_user,revision=public.integration_widgets.revision+1;
   insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
     values(p_user,'integration.widget_updated','integration',p_app::text,
       jsonb_build_object('environment',p_mode,'enabled',p_enabled,'checkout_enabled',p_checkout));
 end if;
 select * into config from public.integration_widgets where integration_id=p_app and environment=p_mode;
 return jsonb_build_object('environment',p_mode,'enabled',coalesce(config.enabled,false),
   'checkoutEnabled',coalesce(config.checkout_enabled,false),'revision',coalesce(config.revision,0));
end; $$;
create function public.revoke_integration_manager_widgets() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.can_manage_integrations and (tg_op='DELETE' or not new.can_manage_integrations) then
   update public.integration_widgets set enabled=false,checkout_enabled=false,revision=revision+1
     where managed_by=old.user_id and integration_id in(select id from public.integrations where organiser_id=old.organiser_id);
 end if;
 return null;
end; $$;
create trigger integration_widgets_manager_revoked after delete or update of can_manage_integrations
 on public.organiser_memberships for each row execute function public.revoke_integration_manager_widgets();

create function public.require_integration_widget(p_widget text,p_mode text,p_origin text,p_event uuid,p_checkout boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_integration_resource_mode(p_mode);
 select jsonb_build_object('integrationId',a.id,'organiserId',a.organiser_id,'widgetConfigId',w.id,
   'revision',w.revision,'checkoutEnabled',w.checkout_enabled,'expiresAt',now()+interval '31 minutes') into result
 from public.integrations a join public.integration_widgets w on w.integration_id=a.id
 join public.integration_domains d on d.integration_id=a.id and d.environment=w.environment
 join public.integration_event_grants g on g.integration_id=a.id and g.organiser_id=a.organiser_id
 join public.events e on e.id=g.event_id and e.organiser_id=a.organiser_id
 where a.widget_id=p_widget and a.status='active' and w.enabled and w.environment=p_mode and d.origin=p_origin
   and public.integration_manager(w.managed_by,a.organiser_id) and e.id=p_event and e.status='published' and e.ends_at>now()
   and (not p_checkout or w.checkout_enabled);
 if result is null then raise exception 'Widget or event unavailable.' using errcode='NT404'; end if;
 return result;
end; $$;
create function public.read_integration_widget(p_widget text,p_mode text,p_origin text,p_event uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor jsonb; result jsonb;
begin
 actor:=public.require_integration_widget(p_widget,p_mode,p_origin,p_event);
 if (select count(*) from public.ticket_types where event_id=p_event and active)>100 then
   raise exception 'Ticket list unavailable.' using errcode='NT409'; end if;
 select jsonb_build_object('actor',actor,'event',public.integration_event_projection(e),
   'tickets',coalesce((select jsonb_agg(jsonb_build_object('ticket',s.ticket,
     'max_packages',(s.availability->>'max_packages_at_current_price')::integer) order by s.sort_order,s.id)
     from public.integration_ticket_snapshot(p_event) s),'[]'::jsonb)) into result
 from public.events e where e.id=p_event;
 return result;
end; $$;

-- Shared actor resolution: public widget permissions are a separate, explicit
-- grant. No synthetic API key is minted or exposed to the embedding website.
create function public.integration_checkout_actor(p_key uuid,p_digest text,p_mode text,p_widget text,p_origin text,p_event uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_widget is not null then
   if p_key is not null or p_digest is not null then raise exception 'Invalid actor.' using errcode='NT400'; end if;
   return public.require_integration_widget(p_widget,p_mode,p_origin,p_event,true);
 end if;
 return public.require_integration_event_reader(p_key,p_digest,p_mode,'checkout:write');
end; $$;

-- Shared session validation/storage function and compatibility wrappers follow.
create function public.create_scoped_integration_session(
 p_key_id uuid,p_digest text,p_environment text,p_session_id uuid,p_event_id uuid,p_items jsonb,p_promo_code text,
 p_return_url text,p_cancel_url text,p_idempotency_digest text,p_payload_hash text,p_capability_hash text,p_reservation_hash text,
 p_signing_version text,p_expires_at timestamptz,
 p_widget_id text default null,p_parent_origin text default null,p_widget_revision integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb; existing public.integration_checkout_sessions%rowtype; item jsonb; tier public.ticket_types%rowtype;
 total_admissions integer:=0; seen uuid[]:='{}'; qty integer;
begin
 identity:=public.integration_checkout_actor(p_key_id,p_digest,p_environment,p_widget_id,p_parent_origin,p_event_id);
 -- Serialize application/session creation, including an absent idempotency row.
 perform 1 from public.integrations where id=(identity->>'integrationId')::uuid for update;
 if p_widget_id is null then
   perform 1 from public.integration_api_keys where id=p_key_id for share;
 else
   perform 1 from public.integration_widgets where id=(identity->>'widgetConfigId')::uuid for share;
 end if;
 identity:=public.integration_checkout_actor(p_key_id,p_digest,p_environment,p_widget_id,p_parent_origin,p_event_id);
 if p_widget_id is not null and ((identity->>'revision')::integer is distinct from p_widget_revision
   or not starts_with(p_return_url,p_parent_origin||'/') or not starts_with(p_cancel_url,p_parent_origin||'/')) then
   raise exception 'Widget configuration changed.' using errcode='NT403'; end if;
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
  if existing.payload_hash<>p_payload_hash or existing.widget_configuration_id is distinct from (identity->>'widgetConfigId')::uuid then
    raise exception 'Idempotency payload conflict.' using errcode='NT409'; end if;
  return public.integration_checkout_snapshot(existing.id);
 end if;
 if (select count(*) from public.integration_checkout_sessions where integration_id=(identity->>'integrationId')::uuid and expires_at>now())>=1000 then
  raise exception 'Too many active checkout sessions.' using errcode='NT409'; end if;
 if p_widget_id is null and not public.integration_key_can_access_event(p_key_id,p_digest,p_environment,p_event_id,'checkout:write') then
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
 return_url,cancel_url,idempotency_digest,payload_hash,capability_hash,reservation_token_hash,signing_key_version,expires_at,widget_configuration_id,widget_revision,widget_origin)
 values(p_session_id,(identity->>'integrationId')::uuid,(identity->>'organiserId')::uuid,p_key_id,p_environment,p_event_id,p_items,p_promo_code,
 p_return_url,p_cancel_url,p_idempotency_digest,p_payload_hash,p_capability_hash,p_reservation_hash,p_signing_version,p_expires_at,
 case when p_widget_id is null then null else (identity->>'widgetConfigId')::uuid end,p_widget_revision,p_parent_origin);
 return public.integration_checkout_snapshot(p_session_id);
end; $$;

create or replace function public.create_integration_checkout_session(
 p_key_id uuid,p_digest text,p_environment text,p_session_id uuid,p_event_id uuid,p_items jsonb,p_promo_code text,
 p_return_url text,p_cancel_url text,p_idempotency_digest text,p_payload_hash text,p_capability_hash text,p_reservation_hash text,
 p_signing_version text,p_expires_at timestamptz
) returns jsonb language sql security definer set search_path='' as $$
 select public.create_scoped_integration_session(p_key_id,p_digest,p_environment,p_session_id,p_event_id,p_items,p_promo_code,
   p_return_url,p_cancel_url,p_idempotency_digest,p_payload_hash,p_capability_hash,p_reservation_hash,p_signing_version,p_expires_at);
$$;

create function public.integration_session_actor_active(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.integration_checkout_sessions s join public.integrations a on a.id=s.integration_id
 join public.integration_event_grants g on g.integration_id=a.id and g.event_id=s.event_id and g.organiser_id=a.organiser_id
 join public.events e on e.id=g.event_id and e.organiser_id=a.organiser_id
 where s.id=p_id and a.status='active' and (
   (s.key_id is not null and exists(select 1 from public.integration_api_keys k where k.id=s.key_id
     and k.integration_id=a.id and k.organiser_id=s.organiser_id and k.environment=s.environment
     and k.revoked_at is null and k.expires_at>now() and 'checkout:write'=any(k.scopes)
     and public.integration_manager(k.created_by,a.organiser_id)))
   or (s.key_id is null and e.status='published' and e.ends_at>now() and exists(
     select 1 from public.integration_widgets w join public.integration_domains d on d.integration_id=w.integration_id
     and d.environment=w.environment and d.origin=s.widget_origin
     where w.id=s.widget_configuration_id and w.integration_id=a.id and w.environment=s.environment
       and w.revision=s.widget_revision and w.enabled and w.checkout_enabled
       and public.integration_manager(w.managed_by,a.organiser_id)))));
$$;
create or replace function public.require_hosted_checkout_active(p_session_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare session public.integration_checkout_sessions%rowtype;
begin
 select * into session from public.integration_checkout_sessions where id=p_session_id;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 perform public.require_integration_resource_mode(session.environment);
 perform 1 from public.integrations where id=session.integration_id for share;
 if session.key_id is not null then
   perform 1 from public.integration_api_keys where id=session.key_id for share;
 else
   perform 1 from public.integration_widgets where id=session.widget_configuration_id for share;
 end if;
 if not public.integration_session_actor_active(session.id) then raise exception 'Checkout disabled.' using errcode='NT403'; end if;
 if session.cancelled_at is not null or session.expires_at<=now() then raise exception 'Checkout expired.' using errcode='NT410'; end if;
end; $$;
create or replace function public.get_hosted_checkout(p_session_id uuid,p_access_hash text)
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
  if session.cancelled_at is not null or not public.integration_session_actor_active(session.id) then
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

-- No browser role can mutate widgets, mint sessions, or call private actor helpers.
do $$ declare fn record; begin
 for fn in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('manage_integration_widget','revoke_integration_manager_widgets',
     'require_integration_widget','read_integration_widget','integration_checkout_actor','create_scoped_integration_session',
     'integration_session_actor_active','require_hosted_checkout_active','get_hosted_checkout','create_integration_checkout_session') loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
   if fn.proname in ('manage_integration_widget','read_integration_widget','create_scoped_integration_session','get_hosted_checkout','create_integration_checkout_session') then
     execute format('grant execute on function %s to service_role',fn.signature); end if;
 end loop;
end; $$;
