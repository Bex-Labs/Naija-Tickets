-- Phase 7: private integration oversight and explicit suspension.
-- Credentials, customer data, webhook bodies/URLs/secrets never enter this view.
alter table public.integrations add column admin_suspended_at timestamptz,
 add column admin_suspension_reason text check(char_length(admin_suspension_reason)<=240);
create or replace function public.save_organiser_integration(
  p_user_id uuid,p_integration_id uuid,p_organiser_id uuid,p_name text,p_status text,p_domains jsonb,p_event_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare app public.integrations%rowtype; domain jsonb; parsed_origin text; parsed_mode text;
begin
  if not public.lock_integration_manager(p_user_id,p_organiser_id) then
    raise exception 'Integration management permission is required.' using errcode='42501'; end if;
  -- Serialise application count/config changes across server instances.
  perform 1 from public.organisers where id=p_organiser_id for update;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 100 or p_status not in ('active','disabled')
    or p_status is null or jsonb_typeof(p_domains) is distinct from 'array' or jsonb_array_length(p_domains)>20
    or p_event_ids is null or cardinality(p_event_ids)>100 then
    raise exception 'Invalid integration configuration.' using errcode='22023'; end if;
  if exists(select 1 from unnest(p_event_ids) requested(id) where not exists(
    select 1 from public.events e where e.id=requested.id and e.organiser_id=p_organiser_id)) then
    raise exception 'Event assignment is not authorised.' using errcode='42501'; end if;
  if p_integration_id is null then
    if (select count(*) from public.integrations where organiser_id=p_organiser_id)>=10 then
      raise exception 'An organiser can register up to 10 integrations.' using errcode='22023'; end if;
    insert into public.integrations(organiser_id,name,status,created_by)
      values(p_organiser_id,trim(p_name),p_status,p_user_id) returning * into app;
  else
    select * into app from public.integrations where id=p_integration_id and organiser_id=p_organiser_id for update;
    if not found then raise exception 'Integration not found.' using errcode='P0002'; end if;
    if app.admin_suspended_at is not null and p_status='active' then
      raise exception 'Application suspended by administrator.' using errcode='NT423'; end if;
    update public.integrations set name=trim(p_name),status=p_status,updated_at=now() where id=app.id;
  end if;
  delete from public.integration_domains where integration_id=app.id;
  for domain in select value from jsonb_array_elements(p_domains) loop
    parsed_origin:=domain->>'origin'; parsed_mode:=domain->>'environment';
    -- Canonical exact origins only. No wildcard, path, userinfo or query.
    if parsed_mode is null or parsed_mode not in ('test','live') or parsed_origin is null
      or char_length(parsed_origin)>255 or parsed_origin !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$' then
      if parsed_mode is distinct from 'test' or parsed_origin is null
        or parsed_origin !~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]{1,5})?$' then
        raise exception 'Use an exact HTTPS origin, or sandbox localhost HTTP.' using errcode='22023'; end if;
    end if;
    if parsed_mode='live' and parsed_origin ~ '^https://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?$' then
      raise exception 'Live integrations require a public HTTPS origin.' using errcode='22023'; end if;
    insert into public.integration_domains(integration_id,environment,origin) values(app.id,parsed_mode,parsed_origin)
      on conflict do nothing;
  end loop;
  delete from public.integration_event_grants where integration_id=app.id;
  insert into public.integration_event_grants(integration_id,organiser_id,event_id)
    select app.id,p_organiser_id,id from (select distinct unnest(p_event_ids) as id) ids;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(p_user_id,case when p_integration_id is null then 'integration.created' else 'integration.updated' end,
      'integration',app.id::text,jsonb_build_object('organiser_id',p_organiser_id,'status',p_status));
  return public.integration_public_metadata(app.id);
end; $$;

create function public.admin_integration_overview(p_search text default '',p_status text default 'all',p_after uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 if p_search is null or char_length(p_search)>80 or p_status is null or p_status not in ('all','active','disabled','suspended') then
  raise exception 'Invalid filters.' using errcode='22023'; end if;
 pattern:='%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%';
 select jsonb_build_object('applications',coalesce((select jsonb_agg(value order by id) from (
  select a.id,jsonb_build_object('id',a.id,'name',a.name,'organiserId',a.organiser_id,'organiserName',o.name,
   'status',a.status,'suspendedAt',a.admin_suspended_at,'suspensionReason',a.admin_suspension_reason,'createdAt',a.created_at,
   'activeKeys',(select count(*) from public.integration_api_keys k where k.integration_id=a.id and k.revoked_at is null and k.expires_at>now()),
   'assignedEvents',(select count(*) from public.integration_event_grants where integration_id=a.id),
   'requests24h',(select count(*) from public.integration_request_logs r where r.integration_id=a.id and r.created_at>now()-interval '1 day'),
   'errors24h',(select count(*) from public.integration_request_logs r where r.integration_id=a.id and r.created_at>now()-interval '1 day' and r.status>=400),
   'pendingDeliveries',(select count(*) from public.integration_webhook_deliveries d join public.integration_webhook_endpoints w on w.id=d.endpoint_id where w.integration_id=a.id and d.status in ('pending','delivering')),
   'exhaustedDeliveries',(select count(*) from public.integration_webhook_deliveries d join public.integration_webhook_endpoints w on w.id=d.endpoint_id where w.integration_id=a.id and d.status='exhausted')) value
  from public.integrations a join public.organisers o on o.id=a.organiser_id
  where (p_after is null or a.id>p_after) and (p_search='' or a.name ilike pattern or o.name ilike pattern)
    and (p_status='all' or (p_status='suspended' and a.admin_suspended_at is not null) or (p_status in ('active','disabled') and a.status=p_status and a.admin_suspended_at is null))
  order by a.id limit 21) page),'[]'::jsonb),
  'totals',jsonb_build_object('applications',(select count(*) from public.integrations),
   'suspended',(select count(*) from public.integrations where admin_suspended_at is not null),
   'requests24h',(select count(*) from public.integration_request_logs where created_at>now()-interval '1 day'),
   'errors24h',(select count(*) from public.integration_request_logs where created_at>now()-interval '1 day' and status>=400),
   'exhaustedDeliveries',(select count(*) from public.integration_webhook_deliveries where status='exhausted')),
  'resourceMode',(select environment from public.integration_resource_settings where singleton),'asOf',now()) into result;
 return result;
end; $$;

create function public.admin_integration_activity(p_app uuid,p_before uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare boundary timestamptz; result jsonb;
begin
 if not exists(select 1 from public.integrations where id=p_app) then raise exception 'Application not found.' using errcode='NT404'; end if;
 if p_before is not null then
  select created_at into boundary from public.integration_request_logs where request_id=p_before and integration_id=p_app;
  if boundary is null then raise exception 'Invalid activity cursor.' using errcode='22023'; end if;
 end if;
 select jsonb_build_object('requests',coalesce((select jsonb_agg(value order by created_at desc,id desc) from (
  select request_id id,created_at,jsonb_build_object('id',request_id,'keyId',key_id,'route',route,'status',status,'errorCode',error_code,'durationMs',duration_ms,'createdAt',created_at) value
  from public.integration_request_logs where integration_id=p_app and (p_before is null or (created_at,request_id)<(boundary,p_before))
  order by created_at desc,request_id desc limit 21) page),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(value order by created_at desc,id desc) from (
  select l.id,l.created_at,jsonb_build_object('id',l.id::text,'action',l.action,'createdAt',l.created_at,
   'actorId',l.actor_id,'adminActorId',l.metadata->>'actor_admin_id',
   'environment',l.metadata->>'environment','keyId',l.metadata->>'key_id','endpointId',l.metadata->>'endpoint_id',
   'outcome',l.metadata->>'outcome') value
  from public.audit_logs l where l.action like 'integration.%' and
   ((l.entity_type='integration' and l.entity_id=p_app::text) or l.metadata->>'integration_id'=p_app::text)
  order by l.created_at desc,l.id desc limit 20) a),'[]'::jsonb)) into result;
 return result;
end; $$;

create function public.admin_suspend_integration(p_app uuid,p_admin text,p_suspend boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare row public.integrations%rowtype;
begin
 if p_admin is null or char_length(p_admin) not between 1 and 100 or p_suspend is null or p_reason is null or char_length(trim(p_reason)) not between 5 and 240 then
  raise exception 'Invalid suspension decision.' using errcode='22023'; end if;
 select * into row from public.integrations where id=p_app for no key update;
 if not found then raise exception 'Application not found.' using errcode='NT404'; end if;
 if p_suspend then
  update public.integrations set status='disabled',admin_suspended_at=coalesce(admin_suspended_at,now()),admin_suspension_reason=trim(p_reason),updated_at=now() where id=p_app;
  update public.integration_api_keys set revoked_at=coalesce(revoked_at,now()) where integration_id=p_app and revoked_at is null;
  update public.integration_widgets set enabled=false,checkout_enabled=false,revision=revision+1 where integration_id=p_app;
  update public.integration_webhook_endpoints set enabled=false,revision=revision+1 where integration_id=p_app and retired_at is null;
 else
  -- Review restores the ability to configure; never restores old credentials,
  -- widgets, endpoints or purchases automatically. Owner must explicitly opt in.
  update public.integrations set status='disabled',admin_suspended_at=null,admin_suspension_reason=null,updated_at=now() where id=p_app;
  update public.integration_widgets set enabled=false,checkout_enabled=false,revision=revision+1 where integration_id=p_app;
  update public.integration_webhook_endpoints set enabled=false,revision=revision+1 where integration_id=p_app and retired_at is null;
 end if;
 insert into public.audit_logs(action,entity_type,entity_id,metadata)
 values(case when p_suspend then 'integration.admin_suspended' else 'integration.admin_restored' end,'integration',p_app::text,
  jsonb_build_object('actor_admin_id',p_admin,'integration_id',p_app,'reason',trim(p_reason)));
end; $$;

-- A slow hash can replace only the exact credential that was successfully
-- verified; a concurrent password/account change cannot be overwritten.
create function public.upgrade_admin_password_hash(p_id text,p_old text,p_new text)
returns boolean language plpgsql security definer set search_path='' as $$
declare setting public.platform_settings%rowtype; updated jsonb; matched boolean:=false;
begin
 if p_id is null or p_old is null or p_new is null or p_old !~ '^[a-f0-9]{64}$' or p_new !~ '^scrypt-v1:[a-f0-9]{128}$' then return false; end if;
 select * into setting from public.platform_settings where key='admin_accounts' for update;
 if found then
  select jsonb_agg(case when value->>'id'=p_id and value->>'password_hash'=p_old then jsonb_set(value,'{password_hash}',to_jsonb(p_new)) else value end order by ordinality),
   bool_or(value->>'id'=p_id and value->>'password_hash'=p_old) into updated,matched
  from jsonb_array_elements(setting.value->'accounts') with ordinality;
  if matched then update public.platform_settings set value=jsonb_set(value,'{accounts}',updated),updated_at=now() where key=setting.key; end if;
  return coalesce(matched,false);
 end if;
 select * into setting from public.platform_settings where key='admin_credentials' for update;
 if found and p_id='primary' and setting.value->>'password_hash'=p_old then
  update public.platform_settings set value=jsonb_set(value,'{password_hash}',to_jsonb(p_new)),updated_at=now() where key=setting.key;
  return true;
 end if;
 -- Environment-only legacy credentials stay compatible until changed through
 -- the existing settings flow. Never silently change environment variables.
 return false;
end; $$;

do $$ declare fn record; definition text; begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('admin_integration_overview','admin_integration_activity','admin_suspend_integration','upgrade_admin_password_hash') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
 definition:=pg_get_functiondef('public.consume_integration_rate_limit(text,integer,integer)'::regprocedure);
 if position('global:v1|' in definition)=0 then raise exception 'Unexpected limiter definition.'; end if;
 execute replace(definition,'global:v1|','admin-login:global|admin-login:(ip|account):[a-f0-9]{64}|global:v1|');
end $$;
notify pgrst, 'reload schema';
