-- Single-project Test/Live integrations. This is additive: no database reset,
-- no existing event conversion and no changes to historical purchases.
alter table public.integration_resource_settings add column local_testing_enabled boolean not null default false;
alter table public.organisers add column is_test boolean not null default false;
alter table public.events add column is_test boolean not null default false;
alter table public.orders add column is_test boolean not null default false;
alter table public.payments add column payment_environment text check(payment_environment in ('test','live'));

create function public.enforce_integration_test_marker() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='organisers' then
  if (tg_op='INSERT' and new.is_test) or (tg_op='UPDATE' and new.is_test is distinct from old.is_test) then
   if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
     nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') not in ('','service_role')
   then raise exception 'Test markers are managed by the server.' using errcode='42501'; end if;
  end if;
 elsif tg_table_name='events' then
  new.is_test:=coalesce((select is_test from public.organisers where id=new.organiser_id),false);
  if new.is_test then new.external_managed:=true; new.featured:=false; end if;
 elsif tg_table_name='orders' then
  new.is_test:=coalesce((select is_test from public.events where id=new.event_id),false);
 end if;
 return new;
end; $$;
create trigger integration_test_marker before insert or update on public.organisers
 for each row execute function public.enforce_integration_test_marker();
create trigger integration_test_marker before insert or update on public.events
 for each row execute function public.enforce_integration_test_marker();
create trigger integration_test_marker before insert or update on public.orders
 for each row execute function public.enforce_integration_test_marker();

create or replace function public.get_integration_resource_settings() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('environment',environment,'project_ref',project_ref,
  'live_project_ref',live_project_ref,'local_testing_enabled',local_testing_enabled)
 from public.integration_resource_settings where singleton;
$$;
create or replace function public.require_integration_resource_mode(p_environment text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.integration_resource_settings where singleton and
  (environment=p_environment or (environment='live' and local_testing_enabled and p_environment='test')))
 then raise exception 'Resource environment not configured.' using errcode='NT503'; end if;
end; $$;

-- Direct raw Test keys on the main tenant can authenticate for introspection,
-- but resource reads/writes must pass through the server's hidden test tenant.
alter function public.require_integration_event_reader(uuid,text,text,text) rename to require_integration_event_reader_pre_local;
create function public.require_integration_event_reader(p_key_id uuid,p_digest text,p_environment text,p_scope text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare identity jsonb;
begin
 identity:=public.require_integration_event_reader_pre_local(p_key_id,p_digest,p_environment,p_scope);
 if exists(select 1 from public.integration_resource_settings where singleton and environment='live' and local_testing_enabled)
  and not exists(select 1 from public.organisers where id=(identity->>'organiserId')::uuid and is_test=(p_environment='test'))
 then raise exception 'Use the matching Test or Live resource.' using errcode='NT403'; end if;
 return identity;
end; $$;
-- Replace the old deployment-only predicate with an event boundary as well.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.integration_key_can_access_event(uuid,text,text,uuid,text)'::regprocedure);
 definition:=replace(definition,'(select environment=p_environment from public.integration_resource_settings where singleton)',
  '(select environment=p_environment or (environment=''live'' and local_testing_enabled and p_environment=''test'') from public.integration_resource_settings where singleton)');
 definition:=replace(definition,'where e.id=p_event_id',
  'where e.id=p_event_id and (not (select local_testing_enabled from public.integration_resource_settings where singleton) or e.is_test=(p_environment=''test''))');
 execute definition;
end; $$;
create table public.integration_test_application_copies (
 source_project text not null, source_app uuid not null references public.integrations(id),
 integration_id uuid not null unique references public.integrations(id), primary key(source_project,source_app)
);
alter table public.integration_test_application_copies enable row level security;
revoke all on public.integration_test_application_copies from public,anon,authenticated;
grant all on public.integration_test_application_copies to service_role;

create function public.sync_local_integration_test_copy(p_source text,p_snapshot jsonb,p_internal_digest text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
<<replica>>
declare source_app uuid; app_id uuid; org_id uuid; owner_id uuid:='00000000-0000-4000-8000-000000000007';
 category_id uuid:='00000000-0000-4000-8000-000000000008'; app jsonb; entry jsonb; e jsonb; t jsonb; detail jsonb;
 event_id uuid; tier_id uuid; key_id uuid; source_key uuid; source_events uuid[]:='{}'; source_tiers uuid[];
 event_map jsonb:='{}'; ticket_map jsonb:='{}'; namespace text; previous_source uuid;
begin
 -- Test records stay in this database, but only in a dedicated hidden tenant.
 if not exists(select 1 from public.integration_resource_settings where singleton
   and environment='live' and local_testing_enabled and (project_ref is null or project_ref=p_source))
 then raise exception 'Local testing is not enabled.' using errcode='NT503'; end if;
 if not exists(select 1 from public.integrations where id=(p_snapshot#>>'{application,id}')::uuid
   and removed_at is null and organiser_id not in(select id from public.organisers where is_test))
 then raise exception 'Source website connection not found.' using errcode='NT404'; end if;
 app:=p_snapshot->'application'; source_app:=(app->>'id')::uuid;
 if source_app is null or jsonb_typeof(p_snapshot->'events') is distinct from 'array'
  or jsonb_array_length(p_snapshot->'events')>100 then raise exception 'Invalid test event template.' using errcode='NT400'; end if;
 namespace:=p_source||':'||source_app::text;
 app_id:=public.integration_test_id('app',p_source,source_app);
 org_id:=public.integration_test_id('organiser',p_source,source_app);
 perform pg_advisory_xact_lock(hashtextextended('test-copy:'||namespace,0));
 -- Credentialless internal actor, created only in the isolated test database.
 insert into auth.users(id) values(owner_id) on conflict do nothing;
 insert into public.profiles(id,full_name) values(owner_id,'Integration test service')
  on conflict(id) do nothing;
 insert into public.organisers(id,name,slug,contact_email,verified_at,is_test)
  values(org_id,'Test · '||coalesce(p_snapshot->>'organiserName','Organiser'),'integration-test-'||org_id::text,'test@invalid.test',now(),true)
  on conflict(id) do update set name=excluded.name;
 insert into public.organiser_memberships(organiser_id,user_id,title,can_manage_integrations)
  values(org_id,owner_id,'Owner',true) on conflict(organiser_id,user_id) do nothing;
 insert into public.categories(id,name,slug,active) values(category_id,'Integration testing','integration-testing',false) on conflict(id) do nothing;
 insert into public.integrations(id,organiser_id,name,status,created_by,setup_mode)
  values(app_id,org_id,left('Test · '||(app->>'name'),100),app->>'status',owner_id,'test')
  on conflict(id) do update set name=excluded.name,status=excluded.status;
 insert into public.integration_test_application_copies values(p_source,source_app,app_id) on conflict do nothing;
 delete from public.integration_domains where integration_id=app_id;
 insert into public.integration_domains(integration_id,environment,origin)
  select app_id,'test',d->>'origin' from jsonb_array_elements(app->'domains') d where d->>'environment'='test';
 for entry in select value from jsonb_array_elements(p_snapshot->'events') loop
  e:=entry->'event'; previous_source:=(e->>'id')::uuid;
  source_events:=array_append(source_events,previous_source);
  event_id:=public.integration_test_id('event',namespace,previous_source);
  event_map:=event_map||jsonb_build_object(previous_source::text,event_id);
  insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,timezone,
   starts_at,ends_at,sales_start_at,sales_end_at,status,image_path,timezone_label,directions_url,external_managed)
  values(event_id,org_id,category_id,'[TEST] '||(e->>'title'),'integration-test-'||event_id::text,coalesce(e->>'presenter_line',''),e->>'description',
   e->>'venue_name',e->>'address',e->>'city',e->>'state',coalesce(e->>'timezone','Africa/Lagos'),
   (e->>'starts_at')::timestamptz,(e->>'ends_at')::timestamptz,(e->>'sales_start_at')::timestamptz,(e->>'sales_end_at')::timestamptz,
   (e->>'status')::public.event_status,e->>'image_path',coalesce(e->>'timezone_label','WAT'),e->>'directions_url',true)
  on conflict(id) do update set title=excluded.title,description=excluded.description,venue_name=excluded.venue_name,address=excluded.address,
   starts_at=excluded.starts_at,ends_at=excluded.ends_at,sales_start_at=excluded.sales_start_at,sales_end_at=excluded.sales_end_at,status=excluded.status;
  delete from public.event_schedule_items where public.event_schedule_items.event_id=replica.event_id;
  for detail in select value from jsonb_array_elements(coalesce(entry->'schedule','[]')) loop
   insert into public.event_schedule_items(event_id,start_time,item_label,sort_order)
    values(event_id,(detail->>'start_time')::time,detail->>'item_label',(detail->>'sort_order')::integer);
  end loop;
  delete from public.event_policies where public.event_policies.event_id=replica.event_id;
  for detail in select value from jsonb_array_elements(coalesce(entry->'policies','[]')) loop
   insert into public.event_policies(event_id,policy_text,sort_order)
    values(event_id,detail->>'policy_text',(detail->>'sort_order')::integer);
  end loop;
  insert into public.integration_test_event_copies values(p_source,source_app,previous_source,app_id,event_id) on conflict do nothing;
  insert into public.integration_event_grants values(app_id,org_id,event_id) on conflict do nothing;
  source_tiers:='{}';
  for t in select value from jsonb_array_elements(entry->'tickets') loop
   tier_id:=public.integration_test_id('ticket',namespace,(t->>'id')::uuid);
   source_tiers:=array_append(source_tiers,tier_id);
   ticket_map:=ticket_map||jsonb_build_object(t->>'id',tier_id);
   insert into public.ticket_types(id,event_id,name,description,price_kobo,standard_price_kobo,early_bird_price_kobo,early_bird_ends_at,
    early_bird_quantity,quantity_total,admissions_per_ticket,min_per_order,max_per_order,sales_start_at,sales_end_at,inclusions,sort_order,active)
   values(tier_id,event_id,t->>'name',t->>'description',(t->>'price_kobo')::bigint,(t->>'standard_price_kobo')::bigint,
    (t->>'early_bird_price_kobo')::bigint,(t->>'early_bird_ends_at')::timestamptz,(t->>'early_bird_quantity')::integer,
    (t->>'quantity_total')::integer,coalesce((t->>'admissions_per_ticket')::integer,1),(t->>'min_per_order')::integer,
    (t->>'max_per_order')::integer,(t->>'sales_start_at')::timestamptz,(t->>'sales_end_at')::timestamptz,
    coalesce(t->'inclusions','[]'),coalesce((t->>'sort_order')::integer,0),(t->>'active')::boolean)
   on conflict(id) do update set name=excluded.name,description=excluded.description,price_kobo=excluded.price_kobo,
    standard_price_kobo=excluded.standard_price_kobo,early_bird_price_kobo=excluded.early_bird_price_kobo,
    early_bird_ends_at=excluded.early_bird_ends_at,early_bird_quantity=excluded.early_bird_quantity,
    quantity_total=greatest(excluded.quantity_total,public.ticket_types.quantity_sold+public.ticket_types.quantity_reserved),
    active=excluded.active;
  end loop;
  update public.ticket_types set active=false where public.ticket_types.event_id=replica.event_id and not(id=any(source_tiers));
 end loop;
 delete from public.integration_event_grants g using public.integration_test_event_copies c
  where c.integration_id=app_id and g.integration_id=app_id and g.event_id=c.event_id and not(c.source_event=any(source_events));
 update public.integration_api_keys k set revoked_at=coalesce(k.revoked_at,now()) where k.integration_id=app_id
  and not exists(select 1 from jsonb_array_elements(app->'keys') source_key_info
   where source_key_info->>'environment'='test' and source_key_info->>'revokedAt' is null
    and (source_key_info->>'expiresAt')::timestamptz>now()
    and public.integration_test_id('key',p_source,(source_key_info->>'id')::uuid)=k.id);
 update public.integration_hosted_links l set enabled=false where l.integration_id=app_id
  and not exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'validLinks','[]')) source_link
   where public.integration_test_id('event',namespace,(source_link->>'eventId')::uuid)=l.event_id
    and source_link->>'returnUrl'=l.return_url and source_link->>'cancelUrl'=l.cancel_url);
 if p_snapshot->'key' is not null and p_snapshot->'key'<>'null'::jsonb then
  if p_internal_digest is null or p_internal_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid internal test authority.' using errcode='NT400'; end if;
  source_key:=(p_snapshot->'key'->>'id')::uuid; key_id:=public.integration_test_id('key',p_source,source_key);
  insert into public.integration_api_keys(id,integration_id,organiser_id,credential_digest,display_prefix,display_suffix,environment,scopes,created_by,expires_at)
   values(key_id,app_id,org_id,p_internal_digest,'nt_test_'||substr(replace(key_id::text,'-',''),1,8),'test','test',
    array(select jsonb_array_elements_text(p_snapshot->'key'->'scopes')),owner_id,(p_snapshot->'key'->>'expiresAt')::timestamptz)
   on conflict(id) do update set credential_digest=excluded.credential_digest,scopes=excluded.scopes,expires_at=excluded.expires_at;
 end if;
 return jsonb_build_object('integrationId',app_id,'organiserId',org_id,'ownerId',owner_id,'keyId',key_id,'events',event_map,'tickets',ticket_map);
end; $$;


create function public.invalidate_local_integration_test_copy(p_source text,p_app uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.integration_resource_settings where singleton and environment='live' and local_testing_enabled and (project_ref is null or project_ref=p_source))
 then raise exception 'Local testing is not enabled.' using errcode='NT503'; end if;
 update public.integrations set status='disabled' where id=public.integration_test_id('app',p_source,p_app);
end; $$;
create function public.local_integration_test_overview(p_source text,p_app uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 if not exists(select 1 from public.integration_resource_settings where singleton and environment='live' and local_testing_enabled and (project_ref is null or project_ref=p_source))
 then raise exception 'Local testing is not enabled.' using errcode='NT503'; end if;
 target:=public.integration_test_id('app',p_source,p_app);
 if not exists(select 1 from public.integrations where id=target) then return null; end if;
 return public.organiser_hosted_overview('00000000-0000-4000-8000-000000000007',target);
end; $$;

-- Every checkout session has the same mode as its immutable event tenant.
create function public.enforce_checkout_test_boundary() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.integration_resource_settings where singleton and environment='live' and local_testing_enabled)
  and not exists(select 1 from public.events where id=new.event_id and is_test=(new.environment='test'))
 then raise exception 'Checkout event mode mismatch.' using errcode='NT403'; end if;
 return new;
end; $$;
create trigger integration_checkout_test_boundary before insert or update on public.integration_checkout_sessions
 for each row execute function public.enforce_checkout_test_boundary();

-- Existing open replica sessions must also respect source grants and revocation.
alter function public.require_hosted_checkout_active(uuid) rename to require_hosted_checkout_active_pre_local;
create function public.require_hosted_checkout_active(p_session_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.integration_checkout_sessions%rowtype; c public.integration_test_event_copies%rowtype; source_app public.integrations%rowtype; source_project text;
begin
 select * into s from public.integration_checkout_sessions where id=p_session_id;
 if s.environment='test' and exists(select 1 from public.integration_resource_settings where singleton and environment='live' and local_testing_enabled) then
  -- Assign the row separately to avoid coupling to future integration columns.
  select a.* into source_app from public.integrations a join public.integration_test_application_copies m on m.source_app=a.id
   where m.integration_id=s.integration_id;
  select m.source_project into source_project from public.integration_test_application_copies m where m.integration_id=s.integration_id;
  if source_app.id is null or source_app.status is distinct from 'active' or source_app.removed_at is not null
    or source_app.admin_suspended_at is not null
  then raise exception 'Test checkout disabled.' using errcode='NT403'; end if;
  select * into c from public.integration_test_event_copies where event_id=s.event_id;
  if c.source_event is not null and (
    not exists(select 1 from public.integration_event_grants where integration_id=c.source_app and event_id=c.source_event)
    or not exists(select 1 from public.events where id=c.source_event and status='published' and ends_at>now()))
  then raise exception 'Test event permission removed.' using errcode='NT403'; end if;
  if s.key_id is not null then
   if not exists(select 1 from public.integration_api_keys k where k.integration_id=source_app.id and environment='test'
     and public.integration_test_id('key',source_project,k.id)=s.key_id and k.revoked_at is null and k.expires_at>now()
     and 'checkout:write'=any(k.scopes) and public.integration_manager(k.created_by,source_app.organiser_id))
   then raise exception 'Test key disabled.' using errcode='NT403'; end if;
  elsif not exists(select 1 from public.integration_hosted_links l where l.integration_id=source_app.id and l.event_id=c.source_event
     and l.environment='test' and l.enabled and l.return_url=s.return_url and l.cancel_url=s.cancel_url
     and public.integration_manager(l.managed_by,source_app.organiser_id))
  then raise exception 'Test link disabled.' using errcode='NT403'; end if;
 end if;
 perform public.require_hosted_checkout_active_pre_local(p_session_id);
end; $$;

-- Pin provider mode before initialization; callbacks/webhooks cannot turn a
-- test transaction into a live sale. Historical unpinned payments are preserved.
alter function public.finalize_paystack_payment(text,text,bigint,text,text,jsonb,text,text,text) rename to finalize_paystack_payment_pre_local;
create function public.finalize_paystack_payment(p_provider_reference text,p_provider_status text,p_amount_kobo bigint,p_currency text,p_provider_transaction_id text,p_payload jsonb,p_provider_event_id text default null,p_event_type text default null,p_payload_hash text default null)
returns table(outcome text,order_id uuid,order_reference text,ticket_count integer)
language plpgsql security definer set search_path='' as $$
declare expected text; test_order boolean;
begin
 select p.payment_environment,o.is_test into expected,test_order from public.payments p join public.orders o on o.id=p.order_id
  where p.provider='paystack' and p.provider_reference=p_provider_reference;
 if (expected is not null and expected is distinct from coalesce(p_payload#>>'{data,domain}',p_payload->>'domain'))
  or (test_order and coalesce(p_payload#>>'{data,domain}',p_payload->>'domain','')<>'test')
 then raise exception 'Payment environment mismatch.' using errcode='NT403'; end if;
 return query select * from public.finalize_paystack_payment_pre_local(p_provider_reference,p_provider_status,p_amount_kobo,p_currency,p_provider_transaction_id,p_payload,p_provider_event_id,p_event_type,p_payload_hash);
end; $$;

create function public.pin_checkout_payment_environment(p_order uuid,p_reference text,p_lease uuid,p_environment text) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_environment is null or p_environment not in ('test','live') then raise exception 'Invalid payment mode.' using errcode='NT400'; end if;
 if exists(select 1 from public.orders where id=p_order and is_test) and p_environment<>'test'
 then raise exception 'Test orders cannot use real payments.' using errcode='NT403'; end if;
 update public.payments set payment_environment=p_environment
 where order_id=p_order and provider='paystack' and provider_reference=p_reference
  and initialize_lease_id=p_lease and initialize_lease_expires_at>now() and authorization_url is null
  and (payment_environment is null or payment_environment=p_environment);
 get diagnostics changed=row_count; return changed=1;
end; $$;

-- Existing metrics keep the same shape, excluding hidden test records.
do $$ declare definition text; begin
 if to_regprocedure('public.admin_sales_analytics()') is not null then
  definition:=pg_get_functiondef('public.admin_sales_analytics()'::regprocedure);
  definition:=replace(definition,'left join public.organisers org on org.id = e.organiser_id',
    'left join public.organisers org on org.id = e.organiser_id where not e.is_test');
  execute definition;
 end if;
 if to_regprocedure('public.admin_integration_overview(text,text,uuid)') is not null then
  definition:=pg_get_functiondef('public.admin_integration_overview(text,text,uuid)'::regprocedure);
  definition:=replace(definition,'where (p_after is null', 'where not o.is_test and (p_after is null');
  definition:=replace(definition,'(select count(*) from public.integrations)',
    '(select count(*) from public.integrations where organiser_id not in(select id from public.organisers where is_test))');
  definition:=replace(definition,'from public.integrations where admin_suspended_at is not null',
    'from public.integrations where organiser_id not in(select id from public.organisers where is_test) and admin_suspended_at is not null');
  execute definition;
 end if;
 if to_regprocedure('public.admin_transactions(text,text,text,integer)') is not null then
  definition:=pg_get_functiondef('public.admin_transactions(text,text,text,integer)'::regprocedure);
  definition:=replace(definition,') p on true',') p on true where not o.is_test');
  execute definition;
 end if;
end; $$;

-- Same database, no new account: opt-in is stored and checked by both SQL/server.
update public.integration_resource_settings set local_testing_enabled=true
 where singleton and environment='live';

do $$ declare fn record; begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('enforce_integration_test_marker','enforce_checkout_test_boundary',
 'pin_checkout_payment_environment','sync_local_integration_test_copy','invalidate_local_integration_test_copy','local_integration_test_overview',
 'require_integration_event_reader','require_integration_event_reader_pre_local','require_hosted_checkout_active',
 'require_hosted_checkout_active_pre_local','finalize_paystack_payment','finalize_paystack_payment_pre_local') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end; $$;
notify pgrst,'reload schema';
