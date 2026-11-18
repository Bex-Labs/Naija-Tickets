-- Hosted checkout upgrade. Additive configuration; no second order/payment ledger.
create table public.integration_hosted_links (
 id uuid primary key default gen_random_uuid(),
 public_id text not null unique default ('nt_link_'||replace(gen_random_uuid()::text,'-','')),
 integration_id uuid not null, organiser_id uuid not null,
 event_id uuid not null references public.events(id), environment text not null check(environment in ('test','live')),
 return_url text not null check(char_length(return_url)<=2048), cancel_url text not null check(char_length(cancel_url)<=2048),
 enabled boolean not null default true, revision integer not null default 1,
 managed_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(integration_id,organiser_id) references public.integrations(id,organiser_id),
 unique(integration_id,event_id,environment), check(public_id ~ '^nt_link_[a-f0-9]{32}$')
);
alter table public.integration_hosted_links enable row level security;
revoke all on public.integration_hosted_links from public,anon,authenticated;
grant all on public.integration_hosted_links to service_role;
alter table public.integration_checkout_sessions
 add column hosted_link_id uuid references public.integration_hosted_links(id),
 add column customer_prefill jsonb not null default '{}'::jsonb check(jsonb_typeof(customer_prefill)='object' and customer_prefill - array['email','name','phone']::text[]='{}'::jsonb and octet_length(customer_prefill::text)<=2048),
 add column external_reference text check(char_length(external_reference)<=100);
-- Replace only the existing actor/intent constraints; preserve all other checks.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.integration_checkout_sessions'::regclass and contype='c'
 and (pg_get_constraintdef(oid) like '%widget_configuration_id%' or pg_get_constraintdef(oid) like '%jsonb_array_length(intent)%') loop
 execute format('alter table public.integration_checkout_sessions drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.integration_checkout_sessions add constraint hosted_intent_check check(jsonb_typeof(intent)='array' and jsonb_array_length(intent) between 0 and 20),
 add constraint hosted_actor_check check(
 (key_id is not null and widget_configuration_id is null and hosted_link_id is null and widget_revision is null and widget_origin is null)
 or (key_id is null and widget_configuration_id is not null and hosted_link_id is null and widget_revision is not null and widget_origin is not null)
 or (key_id is null and widget_configuration_id is null and hosted_link_id is not null and widget_revision is not null and widget_origin is null));
create index hosted_link_sessions_idx on public.integration_checkout_sessions(hosted_link_id,created_at desc);

create function public.manage_hosted_checkout_link(p_user uuid,p_app uuid,p_event uuid,p_mode text,p_return text,p_cancel text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare app public.integrations%rowtype; result jsonb;
begin
 select * into app from public.integrations where id=p_app for update;
 if not found or not public.lock_integration_manager(p_user,app.organiser_id) then raise exception 'Application not found.' using errcode='NT404'; end if;
 if p_mode not in ('test','live') or p_mode is null or p_enabled is null
 or not public.integration_return_allowed(p_app,p_mode,p_return) or not public.integration_return_allowed(p_app,p_mode,p_cancel)
 or not exists(select 1 from public.events e join public.integration_event_grants g on g.event_id=e.id and g.integration_id=p_app
  where e.id=p_event and e.organiser_id=app.organiser_id and g.organiser_id=app.organiser_id and e.status='published' and e.ends_at>now())
 then raise exception 'Invalid hosted checkout configuration.' using errcode='NT400'; end if;
 if (select count(*) from public.integration_hosted_links where integration_id=p_app)>=100 and not exists(select 1 from public.integration_hosted_links where integration_id=p_app and event_id=p_event and environment=p_mode)
 then raise exception 'Link limit reached.' using errcode='NT409'; end if;
 insert into public.integration_hosted_links(integration_id,organiser_id,event_id,environment,return_url,cancel_url,enabled,managed_by)
 values(p_app,app.organiser_id,p_event,p_mode,p_return,p_cancel,p_enabled,p_user)
 on conflict(integration_id,event_id,environment) do update set return_url=excluded.return_url,cancel_url=excluded.cancel_url,enabled=excluded.enabled,managed_by=p_user,revision=public.integration_hosted_links.revision+1;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(p_user,'integration.hosted_link_updated','integration',p_app::text,jsonb_build_object('event_id',p_event,'environment',p_mode,'enabled',p_enabled));
 select jsonb_build_object('id',id,'publicId',public_id,'eventId',event_id,'environment',environment,'returnUrl',return_url,'cancelUrl',cancel_url,'enabled',enabled,'revision',revision)
 into result from public.integration_hosted_links where integration_id=p_app and event_id=p_event and environment=p_mode;
 return result;
end; $$;
create function public.require_hosted_link(p_public text,p_mode text,p_origin text,p_event uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor jsonb;
begin
 perform public.require_integration_resource_mode(p_mode);
 select jsonb_build_object('integrationId',a.id,'organiserId',a.organiser_id,'linkConfigId',l.id,'revision',l.revision,'checkoutEnabled',true,'expiresAt',now()+interval '31 minutes') into actor
 from public.integration_hosted_links l join public.integrations a on a.id=l.integration_id
 join public.events e on e.id=l.event_id and e.organiser_id=a.organiser_id
 join public.integration_event_grants g on g.integration_id=a.id and g.event_id=e.id and g.organiser_id=a.organiser_id
 where l.public_id=p_public and l.environment=p_mode and l.event_id=p_event and l.enabled and a.status='active'
 and l.organiser_id=a.organiser_id and e.status='published' and e.ends_at>now()
 and public.integration_manager(l.managed_by,a.organiser_id)
 and starts_with(l.return_url,p_origin||'/') and public.integration_return_allowed(a.id,p_mode,l.return_url) and public.integration_return_allowed(a.id,p_mode,l.cancel_url);
 if actor is null then raise exception 'Hosted link not found.' using errcode='NT404'; end if;
 return actor;
end; $$;
-- Retain the existing API/widget actor resolution and shared session creation.
alter function public.integration_checkout_actor(uuid,text,text,text,text,uuid) rename to integration_checkout_actor_pre_links;
create function public.integration_checkout_actor(p_key uuid,p_digest text,p_mode text,p_widget text,p_origin text,p_event uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_widget ~ '^nt_link_[a-f0-9]{32}$' then
  if p_key is not null or p_digest is not null then raise exception 'Invalid link actor.' using errcode='NT400'; end if;
  return public.require_hosted_link(p_widget,p_mode,p_origin,p_event);
 end if;
 return public.integration_checkout_actor_pre_links(p_key,p_digest,p_mode,p_widget,p_origin,p_event);
end; $$;
do $$ declare d text; begin
 d:=pg_get_functiondef('public.create_scoped_integration_session(uuid,text,text,uuid,uuid,jsonb,text,text,text,text,text,text,text,text,timestamp with time zone,text,text,integer)'::regprocedure);
 if position('between 1 and 20' in d)=0 or position('widget_revision,widget_origin)' in d)=0 then raise exception 'Unexpected session definition.'; end if;
 d:=replace(d,'between 1 and 20','between 0 and 20');
 d:=replace(d,'perform 1 from public.integration_widgets where id=', 'perform 1 from public.integration_hosted_links where id=(identity->>''linkConfigId'')::uuid for share; perform 1 from public.integration_widgets where id=');
 d:=replace(d,'or existing.widget_configuration_id is distinct from (identity->>''widgetConfigId'')::uuid','or existing.widget_configuration_id is distinct from (identity->>''widgetConfigId'')::uuid or existing.hosted_link_id is distinct from (identity->>''linkConfigId'')::uuid');
 d:=replace(d,'widget_revision,widget_origin)','widget_revision,widget_origin,hosted_link_id)');
 d:=replace(d,'end,p_widget_revision,p_parent_origin);','end,p_widget_revision,case when identity?''linkConfigId'' then null else p_parent_origin end,(identity->>''linkConfigId'')::uuid);');
 execute d;
end $$;
alter function public.integration_session_actor_active(uuid) rename to integration_session_actor_active_pre_links;
create function public.integration_session_actor_active(p_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare s public.integration_checkout_sessions%rowtype; l public.integration_hosted_links%rowtype;
begin
 select * into s from public.integration_checkout_sessions where id=p_id;
 if s.hosted_link_id is null then return public.integration_session_actor_active_pre_links(p_id); end if;
 select * into l from public.integration_hosted_links where id=s.hosted_link_id and revision=s.widget_revision;
 if not found then return false; end if;
 perform public.require_hosted_link(l.public_id,s.environment,substring(l.return_url from '^(https?://[^/]+)'),s.event_id);
 return true;
 exception when sqlstate 'NT404' then return false;
end; $$;
do $$ declare d text; begin
 d:=pg_get_functiondef('public.require_hosted_checkout_active(uuid)'::regprocedure);
 d:=replace(d,'perform 1 from public.integration_widgets where id=session.widget_configuration_id for share;', 'perform 1 from public.integration_hosted_links where id=session.hosted_link_id for share; perform 1 from public.integration_widgets where id=session.widget_configuration_id for share;');
 execute d;
end $$;
create function public.create_hosted_session_v2(p_key_id uuid,p_digest text,p_environment text,p_session_id uuid,p_event_id uuid,p_items jsonb,p_promo_code text,p_return_url text,p_cancel_url text,p_idempotency_digest text,p_payload_hash text,p_capability_hash text,p_reservation_hash text,p_signing_version text,p_expires_at timestamptz,p_customer jsonb default '{}'::jsonb,p_external_reference text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.create_integration_checkout_session(p_key_id,p_digest,p_environment,p_session_id,p_event_id,p_items,p_promo_code,p_return_url,p_cancel_url,p_idempotency_digest,p_payload_hash,p_capability_hash,p_reservation_hash,p_signing_version,p_expires_at);
 update public.integration_checkout_sessions set customer_prefill=p_customer,external_reference=p_external_reference where id=(result->>'id')::uuid and order_id is null;
 return public.integration_checkout_snapshot((result->>'id')::uuid);
end; $$;
create function public.update_hosted_selection(p_session uuid,p_access text,p_items jsonb,p_promo text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.integration_checkout_sessions%rowtype; item jsonb; tier jsonb; available integer; normalized jsonb; admissions integer:=0; ids uuid[]:='{}'; qty integer;
begin
 select * into s from public.integration_checkout_sessions where id=p_session and capability_hash=p_access;
 if not found then raise exception 'Checkout not found.' using errcode='NT404'; end if;
 perform public.lock_event_checkout_inventory(s.event_id);
 perform public.require_hosted_checkout_active(s.id);
 select * into s from public.integration_checkout_sessions where id=p_session for update;
 if s.order_id is not null then raise exception 'Booking already reserved.' using errcode='NT409'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'Choose tickets.' using errcode='NT400'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2 or not(item?'ticket_type_id' and item?'quantity') or (item->>'quantity') !~ '^[1-9][0-9]?$' then raise exception 'Invalid selection.' using errcode='NT400'; end if;
  qty:=(item->>'quantity')::integer;
  select ticket,(availability->>'max_packages_at_current_price')::integer into tier,available from public.integration_ticket_snapshot(s.event_id) where id=(item->>'ticket_type_id')::uuid;
  if tier is null or (item->>'ticket_type_id')::uuid=any(ids) or tier->>'sale_status'<>'open'
   or qty>available or qty<(tier->>'min_packages_per_order')::integer or qty>least(20,(tier->>'max_packages_per_order')::integer)
  then raise exception 'Tickets unavailable.' using errcode='NT409'; end if;
  admissions:=admissions+qty*(tier->>'admissions_per_ticket')::integer; ids:=array_append(ids,(item->>'ticket_type_id')::uuid);
 end loop;
 if admissions>400 then raise exception 'Too many admissions.' using errcode='NT400'; end if;
 select jsonb_agg(value order by value->>'ticket_type_id') into normalized from jsonb_array_elements(p_items);
 update public.integration_checkout_sessions set intent=normalized,promo_code=p_promo where id=s.id;
end; $$;
create function public.hosted_checkout_details(p_session uuid,p_access text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; s public.integration_checkout_sessions%rowtype;
begin
 result:=public.get_hosted_checkout(p_session,p_access);
 select * into s from public.integration_checkout_sessions where id=p_session;
 return result||jsonb_build_object('catalogue',(select coalesce(jsonb_agg(jsonb_build_object('ticket',ticket,'max_packages',(availability->>'max_packages_at_current_price')::integer) order by sort_order,id),'[]'::jsonb) from public.integration_ticket_snapshot(s.event_id)),
 'customer',s.customer_prefill,
 'return_url',case when public.integration_return_allowed(s.integration_id,s.environment,s.return_url) then s.return_url else null end,
 'cancel_url',case when public.integration_return_allowed(s.integration_id,s.environment,s.cancel_url) then s.cancel_url else null end);
end; $$;
-- All new helpers and configuration remain service-only; organiser HTTP routes
-- authenticate a confirmed user and each management RPC rechecks manager authority.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('manage_hosted_checkout_link','require_hosted_link','integration_checkout_actor_pre_links','integration_checkout_actor','integration_session_actor_active_pre_links','integration_session_actor_active','create_hosted_session_v2','update_hosted_selection','hosted_checkout_details') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create function public.integration_hosted_report(p_app uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with app as(select * from public.integrations where id=p_app),
 sessions as(select s.*,public.integration_checkout_snapshot(s.id) snapshot from public.integration_checkout_sessions s where s.integration_id=p_app and s.created_at>=now()-interval '30 days'),
 rows as(select o.*,case when s.hosted_link_id is not null then 'hosted_link' when s.widget_configuration_id is not null then 'legacy_widget' when s.id is not null then 'hosted_api' else 'direct' end source,
 coalesce((select sum(i.quantity*i.admissions_per_ticket) from public.order_items i where i.order_id=o.id),0) admissions,
 coalesce((select sum(r.amount_kobo) from public.refunds r where r.order_id=o.id and r.status='completed' and r.provider_confirmed_at is not null),0) refunded
 from public.orders o join public.events e on e.id=o.event_id join app a on a.organiser_id=e.organiser_id
 left join public.integration_checkout_sessions s on s.id=o.integration_checkout_session_id
 where o.created_at>=now()-interval '30 days' and exists(select 1 from public.integration_event_grants g where g.integration_id=p_app and g.event_id=e.id and g.organiser_id=e.organiser_id)
 and (s.id is null or s.integration_id=p_app) and exists(select 1 from public.payments p where p.order_id=o.id and p.status in ('verified','refunded'))
 and o.status in ('paid','partially_refunded','refunded'))
 select jsonb_build_object('periodDays',30,'asOf',now(),
 'channels',coalesce((select jsonb_agg(jsonb_build_object('source',source,'purchases',purchases,'admissions',admissions,'ticketRevenueKobo',ticket_revenue,'feesKobo',fees,'refundedKobo',refunded)) from
 (select source,count(*) purchases,sum(admissions) admissions,sum(subtotal_kobo-discount_kobo) ticket_revenue,sum(fee_kobo) fees,sum(refunded) refunded from rows group by source) grouped),'[]'::jsonb),
 'funnel',coalesce((select jsonb_agg(jsonb_build_object('source',source,'created',created,'completed',completed,'expired',expired,'cancelled',cancelled,'conversionPercent',round(100.0*completed/nullif(created,0),1))) from
 (select case when hosted_link_id is not null then 'hosted_link' when widget_configuration_id is not null then 'legacy_widget' else 'hosted_api' end source,
 count(*) created,count(*) filter(where snapshot->>'status' in ('paid','refunded','partially_refunded')) completed,
 count(*) filter(where snapshot->>'status'='expired') expired,count(*) filter(where snapshot->>'status'='cancelled') cancelled from sessions group by 1) grouped),'[]'::jsonb),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'eventId',event_id,'createdAt',created_at,'status',snapshot->>'status','orderId',order_id,'admissions',snapshot->'admissions','totalKobo',snapshot->'total_kobo','source',case when hosted_link_id is not null then 'hosted_link' when widget_configuration_id is not null then 'legacy_widget' else 'hosted_api' end) order by created_at desc,id desc)
 from(select * from sessions order by created_at desc,id desc limit 50) recent),'[]'::jsonb));
$$;
create function public.organiser_hosted_overview(p_user uuid,p_app uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select organiser_id into org from public.integrations where id=p_app;
 if not public.integration_manager(p_user,org) then raise exception 'Application not found.' using errcode='NT404'; end if;
 return jsonb_build_object('links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'publicId',public_id,'eventId',event_id,'environment',environment,'returnUrl',return_url,'cancelUrl',cancel_url,'enabled',enabled,'revision',revision) order by created_at desc) from public.integration_hosted_links where integration_id=p_app),'[]'::jsonb),'report',public.integration_hosted_report(p_app));
end; $$;
revoke all on function public.integration_hosted_report(uuid),public.organiser_hosted_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.integration_hosted_report(uuid),public.organiser_hosted_overview(uuid,uuid) to service_role;
create function public.read_hosted_link(p_public text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.integration_hosted_links%rowtype; actor jsonb;
begin
 select * into l from public.integration_hosted_links where public_id=p_public;
 if not found then raise exception 'Link not found.' using errcode='NT404'; end if;
 actor:=public.require_hosted_link(p_public,l.environment,substring(l.return_url from '^(https?://[^/]+)'),l.event_id);
 return jsonb_build_object('id',l.id,'publicId',l.public_id,'integrationId',l.integration_id,'organiserId',l.organiser_id,'eventId',l.event_id,'environment',l.environment,'returnUrl',l.return_url,'cancelUrl',l.cancel_url,'revision',l.revision,'event',(select public.integration_event_projection(e) from public.events e where e.id=l.event_id));
end; $$;
revoke all on function public.read_hosted_link(text) from public,anon,authenticated;
grant execute on function public.read_hosted_link(text) to service_role;
-- Extend the session projection; private buyer prefill never enters status APIs.
alter function public.integration_checkout_snapshot(uuid) rename to integration_checkout_snapshot_pre_links;
create function public.integration_checkout_snapshot(p_session_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.integration_checkout_snapshot_pre_links(s.id)||jsonb_build_object('source',case when s.hosted_link_id is not null then 'hosted_link' when s.widget_configuration_id is not null then 'legacy_widget' else 'hosted_api' end,'external_reference',s.external_reference,
 'status',case when o.status in ('paid','refunded','partially_refunded') and exists(select 1 from public.payments p where p.order_id=o.id and p.status in ('verified','refunded')) then o.status::text else public.integration_checkout_snapshot_pre_links(s.id)->>'status' end)
 from public.integration_checkout_sessions s left join public.orders o on o.id=s.order_id where s.id=p_session_id;
$$;
revoke all on function public.integration_checkout_snapshot(uuid),public.integration_checkout_snapshot_pre_links(uuid) from public,anon,authenticated;
grant execute on function public.integration_checkout_snapshot(uuid) to service_role;
