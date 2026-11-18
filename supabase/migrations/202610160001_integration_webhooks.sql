-- Phase 4: transactional partner notifications. No second payment/ticket engine.
create table public.integration_webhook_endpoints (
 id uuid primary key, integration_id uuid not null references public.integrations(id),
 environment text not null check(environment in ('test','live')),
 url text not null check(char_length(url)<=2048 and url ~ '^https://[a-z0-9.-]+(/[^?#]*)?$'),
 origin text not null, events text[] not null check(cardinality(events) between 1 and 6 and
   events <@ array['order.created','order.paid','group.admissions_reserved','ticket.issued','ticket.checked_in','refund.completed']),
 enabled boolean not null default true, encrypted_secret text not null check(char_length(encrypted_secret) between 60 and 512),
 revision integer not null default 1, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), retired_at timestamptz
);
create unique index integration_webhook_active_url on public.integration_webhook_endpoints(integration_id,environment,url) where retired_at is null;
create table public.integration_outbox_events (
 id uuid primary key, integration_id uuid not null references public.integrations(id),
 environment text not null check(environment in ('test','live')), event_id uuid not null references public.events(id),
 type text not null check(type in ('order.created','order.paid','group.admissions_reserved','ticket.issued','ticket.checked_in','refund.completed')),
 resource_id uuid not null, body text not null check(octet_length(body)<=16384),
 created_at timestamptz not null default now(), unique(integration_id,type,resource_id)
);
create table public.integration_webhook_deliveries (
 id uuid primary key default gen_random_uuid(), endpoint_id uuid not null references public.integration_webhook_endpoints(id),
 outbox_id uuid not null references public.integration_outbox_events(id),
 status text not null default 'pending' check(status in ('pending','delivering','succeeded','exhausted')),
 attempts integer not null default 0 check(attempts between 0 and 40), retry_count integer not null default 0 check(retry_count between 0 and 3),
 next_attempt_at timestamptz not null default now(), lease_id uuid, lease_expires_at timestamptz,
 lease_revision integer, created_at timestamptz not null default now(), unique(endpoint_id,outbox_id)
);
create index integration_webhook_due_idx on public.integration_webhook_deliveries(next_attempt_at,id)
 where status in ('pending','delivering');
create index integration_webhook_history_idx on public.integration_webhook_deliveries(endpoint_id,created_at desc,id desc);
create table public.integration_webhook_attempts (
 delivery_id uuid not null references public.integration_webhook_deliveries(id), attempt integer not null,
 started_at timestamptz not null default now(), completed_at timestamptz,
 http_status integer check(http_status between 100 and 599),
 outcome text check(outcome in ('success','http_retry','http_permanent','timeout','network_error','destination_blocked','lease_expired','configuration_error')),
 primary key(delivery_id,attempt)
);

-- Insert only events attributed to the application that created this checkout.
-- Deferred transition triggers see the final authoritative state at commit.
create function public.emit_integration_event(p_order uuid,p_type text,p_resource uuid,p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare booking public.orders%rowtype; session public.integration_checkout_sessions%rowtype;
 eid uuid:=gen_random_uuid(); body_text text; stored_id uuid; mode text;
begin
 select * into booking from public.orders where id=p_order;
 if booking.integration_checkout_session_id is null then return; end if;
 select * into session from public.integration_checkout_sessions where id=booking.integration_checkout_session_id;
 select environment into mode from public.integration_resource_settings where singleton;
 if session.id is null or session.order_id is distinct from booking.id or session.environment<>mode
   or session.event_id<>booking.event_id then return; end if;
 if not exists(select 1 from public.integrations a join public.events e on e.organiser_id=a.organiser_id
   join public.integration_event_grants g on g.integration_id=a.id and g.event_id=e.id
   where a.id=session.integration_id and a.status='active' and e.id=booking.event_id) then return; end if;
 if p_type<>'order.created' and (booking.status not in ('paid','partially_refunded','refunded') or
   not exists(select 1 from public.payments p where p.order_id=booking.id and p.status in ('verified','refunded')
     and p.amount_kobo=booking.total_kobo and p.currency=booking.currency and p.verified_at is not null)) then return; end if;
 body_text:=jsonb_build_object('id',eid,'type',p_type,'api_version','2026-10-16',
   'created_at',now(),'environment',session.environment,'integration_id',session.integration_id,
   'data',jsonb_build_object('checkout_session_id',session.id,'order_id',booking.id,'event_id',booking.event_id)||p_details)::text;
 insert into public.integration_outbox_events(id,integration_id,environment,event_id,type,resource_id,body)
 values(eid,session.integration_id,session.environment,booking.event_id,p_type,p_resource,body_text)
 on conflict(integration_id,type,resource_id) do nothing returning id into stored_id;
 if stored_id is null then return; end if;
 insert into public.integration_webhook_deliveries(endpoint_id,outbox_id)
 select w.id,stored_id from public.integration_webhook_endpoints w where w.integration_id=session.integration_id
   and w.environment=session.environment and w.enabled and p_type=any(w.events)
   and public.integration_manager(w.created_by,session.organiser_id)
   and exists(select 1 from public.integration_domains d where d.integration_id=w.integration_id
     and d.environment=w.environment and d.origin=w.origin);
end; $$;

create function public.capture_integration_transition() returns trigger
language plpgsql security definer set search_path='' as $$
declare oid uuid; ticket public.tickets%rowtype; booking public.orders%rowtype;
begin
 if tg_table_name='orders' then
   if tg_op='INSERT' or old.integration_checkout_session_id is distinct from new.integration_checkout_session_id then
     perform public.emit_integration_event(new.id,'order.created',new.id); end if;
   select * into booking from public.orders where id=new.id;
   if new.status='paid' and (tg_op='INSERT' or old.status is distinct from new.status) then
     perform public.emit_integration_event(new.id,'order.paid',new.id,
       jsonb_build_object('amount_kobo',booking.total_kobo,'currency',booking.currency)); end if;
 elsif tg_table_name='tickets' then
   if tg_op='UPDATE' and old.claim_state<>'UNCLAIMED' then return null; end if;
   select * into ticket from public.tickets where id=new.id;
   select order_id into oid from public.order_items where id=ticket.order_item_id;
   if (tg_op='INSERT' or old.claim_state='UNCLAIMED') and ticket.claim_state<>'UNCLAIMED'
     and ticket.qr_token_hash is not null and ticket.status in ('valid','used') then
     perform public.emit_integration_event(oid,'ticket.issued',ticket.id,jsonb_build_object('ticket_id',ticket.id)); end if;
 elsif tg_table_name='group_bookings' then
   select order_id into oid from public.order_items where id=new.order_item_id;
   perform public.emit_integration_event(oid,'group.admissions_reserved',new.id,
     jsonb_build_object('group_booking_id',new.id,'admissions',new.admissions));
 elsif tg_table_name='check_ins' then
   select i.order_id into oid from public.tickets t join public.order_items i on i.id=t.order_item_id
     where t.id=new.ticket_id and t.claim_state='CHECKED_IN' and t.status='used';
   if oid is not null then perform public.emit_integration_event(oid,'ticket.checked_in',new.ticket_id,
     jsonb_build_object('ticket_id',new.ticket_id,'checked_in_at',new.checked_in_at)); end if;
 elsif tg_table_name='refunds' then
   if (tg_op='INSERT' or old.status is distinct from new.status) and new.status='completed'
     and new.provider_confirmed_at is not null and new.provider_refund_id is not null then
     perform public.emit_integration_event(new.order_id,'refund.completed',new.id,
       jsonb_build_object('refund_id',new.id,'amount_kobo',new.amount_kobo)); end if;
 end if;
 return null;
end; $$;
create constraint trigger integration_order_outbox after insert or update on public.orders
 deferrable initially deferred for each row when(new.integration_checkout_session_id is not null)
 execute function public.capture_integration_transition();
create constraint trigger integration_ticket_outbox after insert or update on public.tickets
 deferrable initially deferred for each row when(new.claim_state<>'UNCLAIMED')
 execute function public.capture_integration_transition();
create constraint trigger integration_group_outbox after insert on public.group_bookings
 deferrable initially deferred for each row execute function public.capture_integration_transition();
create constraint trigger integration_entry_outbox after insert on public.check_ins
 deferrable initially deferred for each row execute function public.capture_integration_transition();
create constraint trigger integration_refund_outbox after insert or update on public.refunds
 deferrable initially deferred for each row execute function public.capture_integration_transition();

create function public.require_webhook_manager(p_user uuid,p_app uuid) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organiser_id into org from public.integrations where id=p_app;
 if org is null or not public.lock_integration_manager(p_user,org) then
   raise exception 'Integration management permission is required.' using errcode='42501'; end if;
end; $$;

create function public.save_integration_webhook(p_user uuid,p_app uuid,p_id uuid,p_mode text,
 p_url text,p_origin text,p_events text[],p_encrypted text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_webhook_manager(p_user,p_app);
 perform 1 from public.integrations where id=p_app for update;
 if (select count(*) from public.integration_webhook_endpoints where integration_id=p_app and retired_at is null)>=3
   or (select count(*) from public.integration_webhook_endpoints where integration_id=p_app)>=20 then
   raise exception 'Three webhook endpoints maximum.' using errcode='22023'; end if;
 if not exists(select 1 from public.integration_domains where integration_id=p_app and environment=p_mode and origin=p_origin)
   or not exists(select 1 from public.integration_resource_settings where singleton and environment=p_mode)
   or p_url not like p_origin||'/%' then raise exception 'Register the matching webhook origin and resource mode.' using errcode='22023'; end if;
 insert into public.integration_webhook_endpoints(id,integration_id,environment,url,origin,events,encrypted_secret,created_by)
   values(p_id,p_app,p_mode,p_url,p_origin,p_events,p_encrypted,p_user);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
   values(p_user,'integration.webhook_created','integration',p_app::text,jsonb_build_object('endpoint_id',p_id,'environment',p_mode));
 return p_id;
end; $$;
create function public.update_integration_webhook(p_user uuid,p_app uuid,p_id uuid,p_enabled boolean,p_encrypted text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_webhook_manager(p_user,p_app);
 update public.integration_webhook_endpoints set enabled=p_enabled,revision=revision+1,
   encrypted_secret=coalesce(p_encrypted,encrypted_secret)
   where id=p_id and integration_id=p_app and retired_at is null;
 if not found then raise exception 'Webhook not found.' using errcode='P0002'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
   values(p_user,'integration.webhook_updated','integration',p_app::text,
     jsonb_build_object('endpoint_id',p_id,'enabled',p_enabled,'rotated',p_encrypted is not null));
end; $$;

create function public.retire_integration_webhook(p_user uuid,p_app uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_webhook_manager(p_user,p_app);
 update public.integration_webhook_endpoints set retired_at=now(),enabled=false,revision=revision+1
   where id=p_id and integration_id=p_app and retired_at is null;
 if not found then raise exception 'Webhook not found.' using errcode='P0002'; end if;
 update public.integration_webhook_attempts a set completed_at=now(),outcome='configuration_error'
   from public.integration_webhook_deliveries d where a.delivery_id=d.id and d.endpoint_id=p_id and a.completed_at is null;
 update public.integration_webhook_deliveries set status='exhausted',lease_id=null,lease_expires_at=null
   where endpoint_id=p_id and status in ('pending','delivering');
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
   values(p_user,'integration.webhook_retired','integration',p_app::text,jsonb_build_object('endpoint_id',p_id));
end; $$;
create function public.revoke_integration_manager_webhooks() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.can_manage_integrations and (tg_op='DELETE' or not new.can_manage_integrations) then
   update public.integration_webhook_endpoints set enabled=false,revision=revision+1
     where created_by=old.user_id and integration_id in(select id from public.integrations where organiser_id=old.organiser_id);
 end if;
 return null;
end; $$;
create trigger integration_webhooks_manager_revoked after delete or update of can_manage_integrations
 on public.organiser_memberships for each row execute function public.revoke_integration_manager_webhooks();

create function public.list_integration_webhooks(p_user uuid,p_app uuid,p_before uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cursor_time timestamptz; result jsonb; last_id uuid;
begin
 perform public.require_webhook_manager(p_user,p_app);
 if p_before is not null then
   select d.created_at into cursor_time from public.integration_webhook_deliveries d
     join public.integration_webhook_endpoints w on w.id=d.endpoint_id
     where d.id=p_before and w.integration_id=p_app;
   if cursor_time is null then raise exception 'Invalid cursor.' using errcode='22023'; end if;
 end if;
 with page as (select d.*,e.type,e.id as event_id from public.integration_webhook_deliveries d
   join public.integration_webhook_endpoints w on w.id=d.endpoint_id
   join public.integration_outbox_events e on e.id=d.outbox_id where w.integration_id=p_app
   and (p_before is null or (d.created_at,d.id)<(cursor_time,p_before)) order by d.created_at desc,d.id desc limit 21)
 select jsonb_build_object('endpoints',coalesce((select jsonb_agg(jsonb_build_object(
   'id',w.id,'environment',w.environment,'url',w.url,'events',w.events,'enabled',w.enabled,'revision',w.revision,'createdAt',w.created_at,'retiredAt',w.retired_at)
   order by w.created_at) from public.integration_webhook_endpoints w where w.integration_id=p_app),'[]'::jsonb),
   'deliveries',coalesce((select jsonb_agg(row order by created_at desc,id desc) from
     (select p.id,p.created_at,jsonb_build_object('id',p.id,'endpointId',p.endpoint_id,'eventId',p.event_id,'type',p.type,
       'status',p.status,'attempts',p.attempts,'nextAttemptAt',p.next_attempt_at,'createdAt',p.created_at,
       'history',coalesce((select jsonb_agg(jsonb_build_object('attempt',a.attempt,'startedAt',a.started_at,
         'completedAt',a.completed_at,'httpStatus',a.http_status,'outcome',a.outcome) order by a.attempt desc)
         from public.integration_webhook_attempts a where a.delivery_id=p.id),'[]'::jsonb)) as row
      from page p order by p.created_at desc,p.id desc limit 20) x),'[]'::jsonb),
   'nextCursor',case when (select count(*) from page)>20 then
      (select id from page order by created_at desc,id desc offset 19 limit 1) else null end) into result;
 return result;
end; $$;
create function public.retry_integration_webhook(p_user uuid,p_app uuid,p_delivery uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_webhook_manager(p_user,p_app);
 update public.integration_webhook_deliveries d set status='pending',next_attempt_at=now(),
   retry_count=retry_count+1,lease_id=null,lease_expires_at=null
 from public.integration_webhook_endpoints w where w.id=d.endpoint_id and w.integration_id=p_app
   and d.id=p_delivery and d.status='exhausted' and d.retry_count<3 and w.retired_at is null;
 if not found then raise exception 'Only exhausted deliveries can be retried, at most three times.' using errcode='22023'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
   values(p_user,'integration.webhook_retried','integration',p_app::text,jsonb_build_object('delivery_id',p_delivery));
end; $$;

create function public.claim_integration_webhooks(p_mode text,p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; jobs jsonb:='[]'; lease uuid;
begin
 if p_limit not between 1 and 5 or not exists(select 1 from public.integration_resource_settings where singleton and environment=p_mode)
   then raise exception 'Invalid dispatcher mode/batch.' using errcode='22023'; end if;
 for item in select d.*,w.url,w.encrypted_secret,w.revision,w.integration_id,w.environment,e.body,e.id as event_uuid
   from public.integration_webhook_deliveries d join public.integration_webhook_endpoints w on w.id=d.endpoint_id
   join public.integration_outbox_events e on e.id=d.outbox_id join public.integrations app on app.id=w.integration_id
   where (d.status='pending' and d.next_attempt_at<=now() or d.status='delivering' and d.lease_expires_at<=now())
   and w.enabled and app.status='active' and w.environment=p_mode and e.environment=p_mode
   and w.integration_id=e.integration_id and public.integration_manager(w.created_by,app.organiser_id)
   and exists(select 1 from public.integration_event_grants g join public.events ev on ev.id=g.event_id
     where g.integration_id=app.id and g.event_id=e.event_id and ev.organiser_id=app.organiser_id)
   and exists(select 1 from public.integration_domains dom where dom.integration_id=w.integration_id and dom.environment=p_mode and dom.origin=w.origin)
   order by d.next_attempt_at,d.id for update of d skip locked limit p_limit
 loop
   update public.integration_webhook_attempts set completed_at=now(),outcome='lease_expired'
     where delivery_id=item.id and completed_at is null;
   if item.attempts>=8*(item.retry_count+1) then
     update public.integration_webhook_deliveries set status='exhausted',lease_id=null,lease_expires_at=null where id=item.id;
     continue;
   end if;
   lease:=gen_random_uuid();
   update public.integration_webhook_deliveries set status='delivering',attempts=attempts+1,
     lease_id=lease,lease_expires_at=now()+interval '120 seconds',lease_revision=item.revision where id=item.id;
   insert into public.integration_webhook_attempts(delivery_id,attempt) values(item.id,item.attempts+1);
   jobs:=jobs||jsonb_build_array(jsonb_build_object('id',item.id,'endpointId',item.endpoint_id,'integrationId',item.integration_id,
     'environment',p_mode,'url',item.url,'encryptedSecret',item.encrypted_secret,'revision',item.revision,
     'leaseId',lease,'eventId',item.event_uuid,'body',item.body,'attempt',item.attempts+1));
 end loop;
 return jobs;
end; $$;
create function public.authorize_integration_webhook_send(p_id uuid,p_lease uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.integration_webhook_deliveries d
 join public.integration_webhook_endpoints w on w.id=d.endpoint_id
 join public.integration_outbox_events e on e.id=d.outbox_id join public.integrations app on app.id=w.integration_id
 where d.id=p_id and d.lease_id=p_lease and d.status='delivering' and d.lease_expires_at>now()
 and w.revision=d.lease_revision and w.enabled and app.status='active'
 and public.integration_manager(w.created_by,app.organiser_id)
 and exists(select 1 from public.integration_resource_settings where singleton and environment=w.environment)
 and exists(select 1 from public.integration_domains dom where dom.integration_id=w.integration_id and dom.environment=w.environment and dom.origin=w.origin)
 and exists(select 1 from public.integration_event_grants g join public.events ev on ev.id=g.event_id
   where g.integration_id=app.id and g.event_id=e.event_id and ev.organiser_id=app.organiser_id));
$$;
create function public.finish_integration_webhook(p_id uuid,p_lease uuid,p_http integer,p_outcome text,p_delay integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.integration_webhook_deliveries%rowtype;
begin
 select * into job from public.integration_webhook_deliveries where id=p_id and lease_id=p_lease
   and status='delivering' and lease_expires_at>now() for update;
 if not found then return false; end if;
 if p_outcome not in ('success','http_retry','http_permanent','timeout','network_error','destination_blocked','configuration_error')
   or p_delay not between 1 and 86400 or (p_outcome='success' and (p_http is null or p_http not between 200 and 299))
   then raise exception 'Invalid delivery outcome.' using errcode='22023'; end if;
 update public.integration_webhook_attempts set completed_at=now(),http_status=p_http,outcome=p_outcome
   where delivery_id=p_id and attempt=job.attempts;
 update public.integration_webhook_deliveries set status=case when p_outcome='success' then 'succeeded'
   when p_outcome in ('http_permanent','destination_blocked') or job.attempts>=8*(job.retry_count+1) then 'exhausted' else 'pending' end,
   lease_id=null,lease_expires_at=null,next_attempt_at=now()+make_interval(secs=>p_delay) where id=p_id;
 return true;
end; $$;

-- No browser/table/API-key access to secrets, payloads or queue administration.
do $$ declare obj text; fn record; begin
 foreach obj in array array['integration_webhook_endpoints','integration_outbox_events','integration_webhook_deliveries','integration_webhook_attempts'] loop
   execute format('alter table public.%I enable row level security',obj);
   execute format('revoke all on public.%I from public,anon,authenticated',obj);
   execute format('grant all on public.%I to service_role',obj);
 end loop;
 for fn in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('emit_integration_event','capture_integration_transition','require_webhook_manager',
     'save_integration_webhook','update_integration_webhook','retire_integration_webhook','revoke_integration_manager_webhooks','list_integration_webhooks','retry_integration_webhook',
     'claim_integration_webhooks','authorize_integration_webhook_send','finish_integration_webhook') loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
   if fn.proname not in ('emit_integration_event','capture_integration_transition','require_webhook_manager','revoke_integration_manager_webhooks') then
     execute format('grant execute on function %s to service_role',fn.signature); end if;
 end loop;
end; $$;
