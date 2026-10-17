-- Phase 1 only: partner credentials and configuration, no new ticket/payment engine.
alter table public.organiser_memberships
  add column can_manage_integrations boolean not null default false;
-- Only a single unambiguous, server-created Owner gets the initial grant.
update public.organiser_memberships m set can_manage_integrations = true
where m.title = 'Owner' and (select count(*) from public.organiser_memberships other
  where other.organiser_id = m.organiser_id and other.title = 'Owner') = 1;
create function public.bootstrap_integration_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.title = 'Owner' and not exists (select 1 from public.organiser_memberships
    where organiser_id = new.organiser_id) then new.can_manage_integrations := true; end if;
  return new;
end; $$;
create trigger organiser_memberships_integration_owner before insert on public.organiser_memberships
for each row execute function public.bootstrap_integration_owner();

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.organisers(id),
  name text not null check (char_length(trim(name)) between 2 and 100),
  status text not null default 'active' check (status in ('active','disabled')),
  widget_id text not null unique default 'nt_widget_' || replace(gen_random_uuid()::text,'-',''),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organiser_id)
);
create table public.integration_domains (
  integration_id uuid not null references public.integrations(id),
  environment text not null check (environment in ('test','live')),
  origin text not null check (char_length(origin) between 8 and 255),
  primary key(integration_id,environment,origin)
);
create table public.integration_event_grants (
  integration_id uuid not null,
  organiser_id uuid not null,
  event_id uuid not null references public.events(id),
  primary key(integration_id,event_id),
  foreign key(integration_id,organiser_id) references public.integrations(id,organiser_id)
);
create table public.integration_api_keys (
  id uuid primary key,
  integration_id uuid not null,
  organiser_id uuid not null,
  credential_digest text not null unique check (credential_digest ~ '^[a-f0-9]{64}$'),
  display_prefix text not null check (display_prefix ~ '^nt_(test|live)_[a-f0-9]{8}$'),
  display_suffix text not null check (display_suffix ~ '^[A-Za-z0-9_-]{4}$'),
  environment text not null check (environment in ('test','live')),
  scopes text[] not null default array['integration:read']::text[]
    check (scopes <@ array['integration:read']::text[] and cardinality(scopes) <= 1),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz,
  last_used_at timestamptz,
  foreign key(integration_id,organiser_id) references public.integrations(id,organiser_id)
);
create index integration_api_keys_application_idx on public.integration_api_keys(integration_id,created_at desc);
create index integration_event_grants_event_idx on public.integration_event_grants(event_id);
create table public.integration_rate_buckets (
  bucket text not null check (char_length(bucket) <= 100),
  window_start timestamptz not null,
  count integer not null,
  expires_at timestamptz not null,
  primary key(bucket,window_start)
);
create index integration_rate_buckets_expiry_idx on public.integration_rate_buckets(expires_at);
create table public.integration_request_logs (
  request_id uuid primary key,
  integration_id uuid not null references public.integrations(id),
  key_id uuid not null references public.integration_api_keys(id),
  route text not null check (route in ('integration.introspect','api.not_found')),
  status integer not null check (status between 100 and 599),
  error_code text check (error_code ~ '^[A-Z_]{1,64}$'),
  duration_ms integer not null check(duration_ms between 0 and 3600000),
  created_at timestamptz not null default now()
);
create index integration_request_logs_retention_idx on public.integration_request_logs(created_at);
create index integration_request_logs_owner_idx on public.integration_request_logs(integration_id,created_at desc);

create function public.integration_manager(p_user_id uuid,p_organiser_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organiser_memberships
    where user_id=p_user_id and organiser_id=p_organiser_id and can_manage_integrations);
$$;
-- Hold the permission row until a management write commits. A concurrent
-- membership removal cannot race new key creation and later resurrect a key.
create function public.lock_integration_manager(p_user_id uuid,p_organiser_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organiser_memberships where user_id=p_user_id
    and organiser_id=p_organiser_id and can_manage_integrations for share;
  return found;
end; $$;
create function public.revoke_integration_manager_keys() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.can_manage_integrations and (tg_op='DELETE' or not new.can_manage_integrations) then
    update public.integration_api_keys set revoked_at=coalesce(revoked_at,now())
      where organiser_id=old.organiser_id and created_by=old.user_id and revoked_at is null;
    insert into public.audit_logs(action,entity_type,entity_id,metadata)
      values('integration.manager_revoked','organiser_membership',old.organiser_id::text,
        jsonb_build_object('user_id',old.user_id,'reason','membership_removed_or_permission_revoked'));
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger organiser_memberships_revoke_integration_keys after delete or update of can_manage_integrations
on public.organiser_memberships for each row execute function public.revoke_integration_manager_keys();
create index integration_api_keys_issuer_idx on public.integration_api_keys(organiser_id,created_by) where revoked_at is null;

create function public.protect_integration_event_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.events where id=new.event_id and organiser_id=new.organiser_id) then
    raise exception 'Event assignment is not authorised.' using errcode='42501';
  end if;
  return new;
end; $$;
create trigger integration_event_grants_tenant before insert or update on public.integration_event_grants
for each row execute function public.protect_integration_event_grant();

-- Safe metadata projection: credentials/digests are never returned to dashboards.
create function public.integration_public_metadata(p_integration_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',a.id,'organiserId',a.organiser_id,'name',a.name,'status',a.status,
    'widgetId',a.widget_id,'createdAt',a.created_at,
    'domains',coalesce((select jsonb_agg(jsonb_build_object('environment',d.environment,'origin',d.origin)
      order by d.environment,d.origin) from public.integration_domains d where d.integration_id=a.id),'[]'::jsonb),
    'eventIds',coalesce((select jsonb_agg(g.event_id order by g.event_id) from public.integration_event_grants g where g.integration_id=a.id),'[]'::jsonb),
    'keys',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'environment',k.environment,'scopes',k.scopes,
      'display',k.display_prefix||'…'||k.display_suffix,'createdAt',k.created_at,'expiresAt',k.expires_at,
      'revokedAt',k.revoked_at,'lastUsedAt',k.last_used_at) order by k.created_at desc)
      from (select * from public.integration_api_keys where integration_id=a.id order by case when revoked_at is null and expires_at>now() then 0 else 1 end, created_at desc limit 70) k),'[]'::jsonb))
  from public.integrations a where a.id=p_integration_id;
$$;
create function public.list_organiser_integrations(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with managed as (select o.id,o.name from public.organisers o
    where public.integration_manager(p_user_id,o.id))
  select jsonb_build_object(
    'organisers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from managed),'[]'::jsonb),
    'integrations',coalesce((select jsonb_agg(public.integration_public_metadata(a.id) order by a.created_at desc)
      from public.integrations a where a.organiser_id in(select id from managed)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'organiserId',e.organiser_id,'title',e.title,'status',e.status) order by e.title,e.id)
      from public.events e where e.organiser_id in(select id from managed)),'[]'::jsonb));
$$;
create function public.save_organiser_integration(
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

create function public.get_organiser_integration_key_mode(p_user_id uuid,p_integration_id uuid,p_key_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare key_mode text;
begin
  select k.environment into key_mode from public.integration_api_keys k join public.integrations a on a.id=k.integration_id
    where k.id=p_key_id and a.id=p_integration_id and public.integration_manager(p_user_id,a.organiser_id);
  if not found then raise exception 'API key not found.' using errcode='P0002'; end if;
  return key_mode;
end; $$;
create function public.issue_organiser_integration_key(
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
    or p_scopes is null or not(p_scopes <@ array['integration:read']::text[]) or cardinality(p_scopes)>1
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
create function public.revoke_organiser_integration_key(p_user_id uuid,p_integration_id uuid,p_key_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare app public.integrations%rowtype; changed integer;
begin
  select * into app from public.integrations where id=p_integration_id for update;
  if not found or not public.lock_integration_manager(p_user_id,app.organiser_id) then
    raise exception 'Integration not found.' using errcode='P0002'; end if;
  update public.integration_api_keys set revoked_at=coalesce(revoked_at,now()) where id=p_key_id and integration_id=app.id;
  get diagnostics changed = row_count;
  if changed=0 then raise exception 'API key not found.' using errcode='P0002'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'integration.key_revoked','integration_key',p_key_id::text,jsonb_build_object('integration_id',app.id));
  return public.integration_public_metadata(app.id);
end; $$;

create function public.authenticate_integration_key(p_key_id uuid,p_digest text,p_environment text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('keyId',k.id,'integrationId',a.id,'organiserId',a.organiser_id,
    'environment',k.environment,'scopes',k.scopes,'name',a.name,'expiresAt',k.expires_at)
  from public.integration_api_keys k join public.integrations a on a.id=k.integration_id
  where k.id=p_key_id and k.credential_digest=p_digest and k.environment=p_environment
    and k.revoked_at is null and k.expires_at>now() and a.status='active'
    and public.integration_manager(k.created_by,a.organiser_id);
$$;
-- Foundation for scoped future services; this does not expose event data.
create function public.integration_key_can_access_event(p_key_id uuid,p_digest text,p_environment text,p_event_id uuid,p_scope text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.integration_event_grants g join public.events e on e.id=g.event_id
    join public.integrations a on a.id=g.integration_id
    where e.id=p_event_id and e.organiser_id=a.organiser_id and g.organiser_id=a.organiser_id
      and e.status='published' and e.ends_at>now()
      and public.authenticate_integration_key(p_key_id,p_digest,p_environment)->>'integrationId'=a.id::text
      and (public.authenticate_integration_key(p_key_id,p_digest,p_environment)->'scopes') ? p_scope);
$$;
create function public.consume_integration_rate_limit(p_bucket text,p_limit integer,p_window_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare window_at timestamptz; hits integer; retry_seconds integer;
begin
  if p_bucket is null or p_bucket !~ '^(global:v1|ip:[a-f0-9]{64}|(key|integration|organiser|dashboard):[a-f0-9-]{36})$'
    or p_limit is null or p_limit not between 1 and 10000 or p_window_seconds is null or p_window_seconds not between 10 and 3600 then
    raise exception 'Invalid rate limit bucket.' using errcode='22023'; end if;
  window_at:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_window_seconds)*p_window_seconds);
  delete from public.integration_rate_buckets where (bucket,window_start) in (
    select bucket,window_start from public.integration_rate_buckets where expires_at<now() order by expires_at limit 100);
  insert into public.integration_rate_buckets(bucket,window_start,count,expires_at)
    values(p_bucket,window_at,1,window_at+make_interval(secs=>p_window_seconds*2))
    on conflict(bucket,window_start) do update set count=least(public.integration_rate_buckets.count+1,p_limit+1)
    returning count into hits;
  retry_seconds:=greatest(1,ceil(extract(epoch from window_at+make_interval(secs=>p_window_seconds)-clock_timestamp()))::integer);
  return jsonb_build_object('allowed',hits<=p_limit,'retryAfter',retry_seconds);
end; $$;
create function public.record_integration_request(p_request_id uuid,p_key_id uuid,p_route text,p_status integer,p_error_code text,p_duration_ms integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.integration_request_logs where request_id in (
    select request_id from public.integration_request_logs where created_at<now()-interval '30 days' order by created_at limit 100);
  insert into public.integration_request_logs(request_id,integration_id,key_id,route,status,error_code,duration_ms)
    select p_request_id,k.integration_id,k.id,p_route,p_status,p_error_code,p_duration_ms
    from public.integration_api_keys k where k.id=p_key_id on conflict do nothing;
  if p_status between 200 and 299 then update public.integration_api_keys set last_used_at=now() where id=p_key_id; end if;
end; $$;

-- Operational tables and all RPCs are private. Dashboard handlers verify JWTs;
-- DB RPCs check membership independently. There is no browser digest projection.
do $$
declare table_name text; fn record;
begin
  foreach table_name in array array['integrations','integration_domains','integration_event_grants','integration_api_keys','integration_rate_buckets','integration_request_logs'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from anon, authenticated',table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role',table_name);
  end loop;
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('bootstrap_integration_owner','integration_manager','lock_integration_manager','revoke_integration_manager_keys','protect_integration_event_grant',
      'integration_public_metadata','list_organiser_integrations','save_organiser_integration','get_organiser_integration_key_mode',
      'issue_organiser_integration_key','revoke_organiser_integration_key','authenticate_integration_key',
      'integration_key_can_access_event','consume_integration_rate_limit','record_integration_request') loop
    execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end; $$;
notify pgrst, 'reload schema';
