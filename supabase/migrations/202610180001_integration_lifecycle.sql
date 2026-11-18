-- Soft removal preserves issued tickets, orders, payouts, attribution and audit history.
-- Active/disabled remain the existing access states; removed applications stay disabled.
alter table public.integrations add column removed_at timestamptz,
 add constraint removed_integration_disabled check(removed_at is null or status='disabled');
create index integrations_current_organiser_idx on public.integrations(organiser_id,created_at desc) where removed_at is null;

create or replace function public.list_organiser_integrations(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with managed as (select o.id,o.name from public.organisers o
    where public.integration_manager(p_user_id,o.id))
  select jsonb_build_object(
    'organisers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from managed),'[]'::jsonb),
    'integrations',coalesce((select jsonb_agg(public.integration_public_metadata(a.id) order by a.created_at desc)
      from public.integrations a where a.removed_at is null and a.organiser_id in(select id from managed)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'organiserId',e.organiser_id,'title',e.title,'status',e.status) order by e.title,e.id)
      from public.events e where e.organiser_id in(select id from managed)),'[]'::jsonb));
$$;
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
    if (select count(*) from public.integrations where organiser_id=p_organiser_id and removed_at is null)>=10 then
      raise exception 'An organiser can register up to 10 integrations.' using errcode='22023'; end if;
    insert into public.integrations(organiser_id,name,status,created_by)
      values(p_organiser_id,trim(p_name),p_status,p_user_id) returning * into app;
  else
    select * into app from public.integrations where id=p_integration_id and organiser_id=p_organiser_id for update;
    if not found or app.removed_at is not null then raise exception 'Integration not found.' using errcode='P0002'; end if;
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

create or replace function public.admin_integration_overview(p_search text default '',p_status text default 'all',p_after uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 if p_search is null or char_length(p_search)>80 or p_status is null or p_status not in ('all','active','disabled','suspended') then
  raise exception 'Invalid filters.' using errcode='22023'; end if;
 pattern:='%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%';
 select jsonb_build_object('applications',coalesce((select jsonb_agg(value order by id) from (
  select a.id,jsonb_build_object('id',a.id,'name',a.name,'organiserId',a.organiser_id,'organiserName',o.name,
   'status',a.status,'removedAt',a.removed_at,'suspendedAt',a.admin_suspended_at,'suspensionReason',a.admin_suspension_reason,'createdAt',a.created_at,
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

create function public.change_organiser_integration_lifecycle(p_user_id uuid,p_integration_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare app public.integrations%rowtype; org uuid; target text;
begin
 if p_action is null or p_action not in ('enable','disable','remove') then
  raise exception 'Invalid integration action.' using errcode='22023'; end if;
 select organiser_id into org from public.integrations where id=p_integration_id;
 if not found or not public.lock_integration_manager(p_user_id,org) then
  raise exception 'Integration not found.' using errcode='P0002'; end if;
 -- Match configuration lock ordering and serialize app-count/removal changes.
 perform 1 from public.organisers where id=org for update;
 select * into app from public.integrations where id=p_integration_id and organiser_id=org for update;
 if not found then raise exception 'Integration not found.' using errcode='P0002'; end if;
 if app.removed_at is not null then
  if p_action='remove' then return jsonb_build_object('id',app.id,'removed',true); end if;
  raise exception 'Integration not found.' using errcode='P0002';
 end if;
 if p_action='enable' and app.admin_suspended_at is not null then
  raise exception 'Application suspended by administrator.' using errcode='NT423'; end if;
 target:=case when p_action='enable' then 'active' else 'disabled' end;
 if p_action<>'remove' and app.status=target then return public.integration_public_metadata(app.id); end if;
 update public.integrations set status=target,removed_at=case when p_action='remove' then now() else null end,updated_at=now() where id=app.id;
 if p_action='remove' then
  update public.integration_api_keys set revoked_at=now() where integration_id=app.id and revoked_at is null;
  update public.integration_widgets set enabled=false,checkout_enabled=false,revision=revision+1 where integration_id=app.id;
  update public.integration_hosted_links set enabled=false,revision=revision+1 where integration_id=app.id;
  update public.integration_webhook_endpoints set enabled=false,revision=revision+1 where integration_id=app.id and retired_at is null;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_user_id,case p_action when 'remove' then 'integration.removed' when 'disable' then 'integration.disabled' else 'integration.enabled' end,
  'integration',app.id::text,jsonb_build_object('organiser_id',org));
 if p_action='remove' then return jsonb_build_object('id',app.id,'removed',true); end if;
 return public.integration_public_metadata(app.id);
end; $$;
revoke all on function public.change_organiser_integration_lifecycle(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.change_organiser_integration_lifecycle(uuid,uuid,text) to service_role;

-- Removed apps cannot be reconfigured through a saved widget/webhook/link URL.
create or replace function public.require_webhook_manager(p_user uuid,p_app uuid) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organiser_id into org from public.integrations where id=p_app and removed_at is null;
 if org is null or not public.lock_integration_manager(p_user,org) then
   raise exception 'Integration management permission is required.' using errcode='42501'; end if;
end; $$;

create or replace function public.manage_hosted_checkout_link(p_user uuid,p_app uuid,p_event uuid,p_mode text,p_return text,p_cancel text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare app public.integrations%rowtype; result jsonb;
begin
 select * into app from public.integrations where id=p_app for update;
 if not found or app.removed_at is not null or not public.lock_integration_manager(p_user,app.organiser_id) then raise exception 'Application not found.' using errcode='NT404'; end if;
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
