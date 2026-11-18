-- One organiser dashboard; test checkout continues to use a separate database.
alter table public.integrations
  add column setup_mode text not null default 'live' check(setup_mode in ('test','live')),
  add column website_location text not null default 'hosted' check(website_location in ('local','hosted'));
update public.integrations a set setup_mode='test' where exists(select 1 from public.integration_domains d where d.integration_id=a.id and environment='test')
 and not exists(select 1 from public.integration_domains d where d.integration_id=a.id and environment='live');
update public.integrations a set website_location='local' where setup_mode='test'
 and exists(select 1 from public.integration_domains d where d.integration_id=a.id and environment='test' and origin ~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?$')
 and not exists(select 1 from public.integration_domains d where d.integration_id=a.id and environment='test' and origin !~ '^https?://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?$');

alter function public.integration_public_metadata(uuid) rename to integration_public_metadata_pre_testing;
create function public.integration_public_metadata(p_integration_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.integration_public_metadata_pre_testing(a.id) || jsonb_build_object(
  'setupMode',a.setup_mode,'websiteLocation',a.website_location)
 from public.integrations a where a.id=p_integration_id;
$$;

create function public.save_integration_setup(p_user_id uuid,p_integration_id uuid,p_organiser_id uuid,
 p_name text,p_status text,p_domains jsonb,p_event_ids uuid[],p_setup_mode text,p_website_location text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
 if p_setup_mode is null or p_setup_mode not in ('test','live') or p_website_location is null
  or p_website_location not in ('local','hosted') or (p_setup_mode='live' and p_website_location='local')
  or not exists(select 1 from jsonb_array_elements(p_domains) d where d->>'environment'=p_setup_mode)
  or exists(select 1 from jsonb_array_elements(p_domains) d where d->>'environment'=p_setup_mode and
   ((d->>'origin' ~ '^https?://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?$') is distinct from (p_website_location='local')))
 then raise exception 'Choose a matching website location, purchase mode and website address.' using errcode='NT400'; end if;
 saved:=public.save_organiser_integration(p_user_id,p_integration_id,p_organiser_id,p_name,p_status,p_domains,p_event_ids);
 update public.integrations set setup_mode=p_setup_mode,website_location=p_website_location where id=(saved->>'id')::uuid;
 return public.integration_public_metadata((saved->>'id')::uuid);
end; $$;

-- Called only by the authenticated main server. No credentials/customer records
-- are included in the event template, and client supplied prices never enter it.
create function public.integration_testing_snapshot(p_app uuid,p_user uuid default null,p_key uuid default null,p_digest text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare app public.integrations%rowtype; identity jsonb; key_info jsonb;
begin
 select * into app from public.integrations where id=p_app and removed_at is null;
 if not found then raise exception 'Website connection not found.' using errcode='NT404'; end if;
 if p_key is not null then
  identity:=public.authenticate_integration_key(p_key,p_digest,'test');
  if identity is null or identity->>'integrationId'<>app.id::text then raise exception 'Invalid API key.' using errcode='NT401'; end if;
  select jsonb_build_object('id',k.id,'scopes',k.scopes,'expiresAt',k.expires_at) into key_info
   from public.integration_api_keys k where k.id=p_key;
 elsif p_user is null or not public.integration_manager(p_user,app.organiser_id) then
  raise exception 'Integration management permission is required.' using errcode='NT403';
 end if;
 return jsonb_build_object('application',public.integration_public_metadata(app.id),
  'organiserName',(select name from public.organisers where id=app.organiser_id),'key',key_info,
  'validLinks',coalesce((select jsonb_agg(jsonb_build_object('eventId',l.event_id,'returnUrl',l.return_url,'cancelUrl',l.cancel_url))
   from public.integration_hosted_links l where l.integration_id=app.id and l.environment='test' and l.enabled
    and public.integration_manager(l.managed_by,app.organiser_id)),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('event',to_jsonb(e),'tickets',
    coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order,t.id) from public.ticket_types t where t.event_id=e.id),'[]'::jsonb),
    'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from public.event_schedule_items s where s.event_id=e.id),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order) from public.event_policies p where p.event_id=e.id),'[]'::jsonb)))
   from public.events e join public.integration_event_grants g on g.event_id=e.id
    where g.integration_id=app.id and e.organiser_id=app.organiser_id),'[]'::jsonb));
end; $$;

create function public.integration_test_id(p_kind text,p_source text,p_id uuid) returns uuid
language sql immutable set search_path='' as $$
 select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
 from (select md5(p_kind||':'||p_source||':'||p_id::text) h) x;
$$;
create table public.integration_test_event_copies (
 source_project text not null,source_app uuid not null,source_event uuid not null,
 integration_id uuid not null references public.integrations(id),event_id uuid not null unique references public.events(id),
 primary key(source_project,source_app,source_event)
);
alter table public.integration_test_event_copies enable row level security;
revoke all on public.integration_test_event_copies from public,anon,authenticated;
grant all on public.integration_test_event_copies to service_role;

create function public.sync_integration_test_copy(p_source text,p_snapshot jsonb,p_internal_digest text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
<<replica>>
declare source_app uuid; app_id uuid; org_id uuid; owner_id uuid:='00000000-0000-4000-8000-000000000007';
 category_id uuid:='00000000-0000-4000-8000-000000000008'; app jsonb; entry jsonb; e jsonb; t jsonb; detail jsonb;
 event_id uuid; tier_id uuid; key_id uuid; source_key uuid; source_events uuid[]:='{}'; source_tiers uuid[];
 event_map jsonb:='{}'; ticket_map jsonb:='{}'; namespace text; previous_source uuid;
begin
 -- This operation can never write copies into the main production database.
 perform public.require_integration_resource_mode('test');
 if p_source is null or p_source is distinct from (select live_project_ref from public.integration_resource_settings where singleton)
  or p_source=(select project_ref from public.integration_resource_settings where singleton)
  or p_source !~ '^[a-z0-9]{20}$' then raise exception 'Test resource binding mismatch.' using errcode='NT503'; end if;
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
 insert into public.organisers(id,name,slug,contact_email,verified_at)
  values(org_id,'Test · '||coalesce(p_snapshot->>'organiserName','Organiser'),'integration-test-'||org_id::text,'test@invalid.test',now())
  on conflict(id) do update set name=excluded.name;
 insert into public.organiser_memberships(organiser_id,user_id,title,can_manage_integrations)
  values(org_id,owner_id,'Owner',true) on conflict(organiser_id,user_id) do nothing;
 insert into public.categories(id,name,slug) values(category_id,'Integration testing','integration-testing') on conflict(id) do nothing;
 insert into public.integrations(id,organiser_id,name,status,created_by,setup_mode)
  values(app_id,org_id,left('Test · '||(app->>'name'),100),app->>'status',owner_id,'test')
  on conflict(id) do update set name=excluded.name,status=excluded.status;
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

create function public.invalidate_integration_test_copy(p_source text,p_app uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_integration_resource_mode('test');
 if p_source is distinct from (select live_project_ref from public.integration_resource_settings where singleton)
 then raise exception 'Test resource binding mismatch.' using errcode='NT503'; end if;
 update public.integrations set status='disabled' where id=public.integration_test_id('app',p_source,p_app);
end; $$;

create function public.integration_test_overview(p_source text,p_app uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 perform public.require_integration_resource_mode('test');
 if p_source is distinct from (select live_project_ref from public.integration_resource_settings where singleton)
 then raise exception 'Test resource binding mismatch.' using errcode='NT503'; end if;
 target:=public.integration_test_id('app',p_source,p_app);
 if not exists(select 1 from public.integrations where id=target) then return null; end if;
 return public.organiser_hosted_overview('00000000-0000-4000-8000-000000000007',target);
end; $$;

-- Read only main test-link authority; creating the actual session happens in the
-- isolated database. Permission removal is checked before each new checkout.
create function public.read_main_test_link(p_public text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',l.id,'publicId',l.public_id,'integrationId',a.id,'organiserId',a.organiser_id,
  'eventId',e.id,'environment','test','returnUrl',l.return_url,'cancelUrl',l.cancel_url,'revision',l.revision,
  'managedBy',l.managed_by,'event',jsonb_build_object('title','[TEST] '||e.title))
 from public.integration_hosted_links l join public.integrations a on a.id=l.integration_id
 join public.events e on e.id=l.event_id and e.organiser_id=a.organiser_id
 join public.integration_event_grants g on g.integration_id=a.id and g.event_id=e.id and g.organiser_id=a.organiser_id
 where l.public_id=p_public and l.environment='test' and l.enabled and a.status='active' and a.removed_at is null
  and public.integration_manager(l.managed_by,a.organiser_id) and e.status='published' and e.ends_at>now()
  and public.integration_return_allowed(a.id,'test',l.return_url) and public.integration_return_allowed(a.id,'test',l.cancel_url);
$$;

do $$ declare fn record; begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('integration_public_metadata','integration_public_metadata_pre_testing',
 'save_integration_setup','integration_testing_snapshot','integration_test_id','sync_integration_test_copy','read_main_test_link','invalidate_integration_test_copy','integration_test_overview') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end; $$;
notify pgrst,'reload schema';
