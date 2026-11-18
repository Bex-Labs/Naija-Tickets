-- Phase 6: application-attributed reads and explicitly delegated venue entry.
-- No new payment, ticket issuance, claim or refund engine; no existing key gets new scopes.
alter table public.integration_api_keys drop constraint integration_api_keys_scopes_check;
alter table public.integration_api_keys add constraint integration_api_keys_scopes_check check (
 scopes <@ array['integration:read','events:read','tickets:read','availability:read','checkout:write','orders:read','tickets:status','attendees:read','attendees:contact','sales:read','groups:read','refunds:read','entry:verify','entry:check-in']::text[] and cardinality(scopes)<=14 and array_position(scopes,null) is null);
alter table public.integration_request_logs drop constraint integration_request_logs_route_check;
alter table public.integration_request_logs add constraint integration_request_logs_route_check check (
 route in ('integration.introspect','api.not_found','events.list','events.detail','events.tickets','events.availability',
 'checkout.create','checkout.status','advanced.orders','advanced.order','advanced.tickets','advanced.ticket',
 'advanced.attendees','advanced.groups','advanced.refunds','advanced.sales','advanced.entry'));
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
    or p_scopes is null or not(p_scopes <@ array['integration:read','events:read','tickets:read','availability:read','checkout:write','orders:read','tickets:status','attendees:read','attendees:contact','sales:read','groups:read','refunds:read','entry:verify','entry:check-in']::text[]) or cardinality(p_scopes)>14
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


-- Internal helper. History may include ended/unpublished events, but never loses
-- current ownership, explicit event grant or reciprocal order/session attribution.
create function public.integration_attributed_orders(p_app uuid,p_org uuid,p_mode text,p_event uuid default null,p_order uuid default null)
returns setof public.orders language sql stable security definer set search_path='' as $$
 select o.* from public.orders o
 join public.integration_checkout_sessions s on s.id=o.integration_checkout_session_id and s.order_id=o.id
 join public.events e on e.id=o.event_id and e.id=s.event_id
 join public.integration_event_grants g on g.integration_id=s.integration_id and g.event_id=e.id and g.organiser_id=p_org
 where s.integration_id=p_app and s.organiser_id=p_org and s.environment=p_mode and e.organiser_id=p_org
 and (p_event is null or e.id=p_event) and (p_order is null or o.id=p_order);
$$;
create function public.integration_order_verified(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o join public.payments p on p.order_id=o.id
 where o.id=p_id and o.status in ('paid','partially_refunded','refunded') and p.status in ('verified','refunded')
 and p.amount_kobo=o.total_kobo and p.currency=o.currency and p.verified_at is not null);
$$;
create function public.integration_order_projection(o public.orders) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'event_id',o.event_id,'checkout_session_id',o.integration_checkout_session_id,
 'status',o.status,'currency',o.currency,'subtotal_kobo',o.subtotal_kobo,'discount_kobo',o.discount_kobo,
 'fee_kobo',o.fee_kobo,'total_kobo',o.total_kobo,'created_at',o.created_at,'paid_at',o.paid_at,
 'payment_status',case when public.integration_order_verified(o.id) then case when o.status='refunded' then 'refunded' else 'verified' end else 'unverified' end,
 'admissions',(select coalesce(sum(i.quantity*i.admissions_per_ticket),0) from public.order_items i where i.order_id=o.id));
$$;
create function public.integration_ticket_projection(t public.tickets,o public.orders) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'event_id',t.event_id,'order_id',o.id,
 'ticket_type_id',(select ticket_type_id from public.order_items where id=t.order_item_id),
 'group_booking_id',t.group_booking_id,'status',t.status,'claim_state',t.claim_state,'issued_at',t.issued_at,
 'claimed_at',t.claimed_at,'checked_in_at',(select checked_in_at from public.check_ins where ticket_id=t.id),
 'admission_limit',1,'admissions_used',case when t.status='used' or exists(select 1 from public.check_ins where ticket_id=t.id) then 1 else 0 end,
 'usable_for_entry',t.status='valid' and t.claim_state='CLAIMED' and public.integration_order_verified(o.id)
 and o.status in ('paid','partially_refunded') and not exists(select 1 from public.check_ins where ticket_id=t.id)
 and exists(select 1 from public.events where id=t.event_id and status='published' and ends_at>now()));
$$;

create function public.read_integration_operations(p_key uuid,p_digest text,p_mode text,p_operation text,
 p_event uuid default null,p_resource uuid default null,p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare identity jsonb; required_scope text; app uuid; org uuid; rows jsonb; contacts boolean;
begin
 required_scope:=case p_operation when 'orders' then 'orders:read' when 'order' then 'orders:read'
 when 'tickets' then 'tickets:status' when 'ticket' then 'tickets:status' when 'attendees' then 'attendees:read'
 when 'groups' then 'groups:read' when 'refunds' then 'refunds:read' when 'sales' then 'sales:read' end;
 if required_scope is null or p_limit is null or p_limit not between 1 and 100 then
  raise exception 'Invalid operation.' using errcode='NT400'; end if;
 identity:=public.require_integration_event_reader(p_key,p_digest,p_mode,required_scope);
 app:=(identity->>'integrationId')::uuid; org:=(identity->>'organiserId')::uuid;
 contacts:=(identity->'scopes')?'attendees:contact';
 if p_event is not null and not exists(select 1 from public.integration_event_grants g join public.events e on e.id=g.event_id
   where g.integration_id=app and g.organiser_id=org and e.organiser_id=org and e.id=p_event) then
  raise exception 'Resource not found.' using errcode='NT404'; end if;
 if p_operation in ('order','tickets','groups','refunds') and not exists(
   select 1 from public.integration_attributed_orders(app,org,p_mode,p_event,p_resource) where id=p_resource) then
  raise exception 'Resource not found.' using errcode='NT404'; end if;
 if p_operation='ticket' and not exists(select 1 from public.tickets t join public.order_items i on i.id=t.order_item_id
   join public.integration_attributed_orders(app,org,p_mode) o on o.id=i.order_id where t.id=p_resource and t.event_id=o.event_id) then
  raise exception 'Resource not found.' using errcode='NT404'; end if;
 if p_operation='attendees' and p_event is null then raise exception 'Choose an event.' using errcode='NT400'; end if;
 if p_operation in ('orders','order') then
  select coalesce(jsonb_agg(value order by id),'[]'::jsonb) into rows from (
   select o.id,public.integration_order_projection(o) value from public.integration_attributed_orders(app,org,p_mode,p_event,
    case when p_operation='order' then p_resource else null end) o
   where (p_after is null or o.id>p_after) order by o.id limit p_limit+1) page;
 elsif p_operation in ('tickets','ticket','attendees') then
  select coalesce(jsonb_agg(value order by id),'[]'::jsonb) into rows from (
   select t.id,case when p_operation='attendees' then
    jsonb_build_object('ticket_id',t.id,'order_id',o.id,'event_id',t.event_id,'group_booking_id',t.group_booking_id,
     'claim_state',t.claim_state,'ticket_status',t.status,'personal_data_erased',o.personal_data_erased_at is not null,
     'name',case when o.personal_data_erased_at is null then t.attendee_name else null end)
    || case when contacts then jsonb_build_object('email',case when o.personal_data_erased_at is null then t.attendee_email else null end,
     'phone',case when o.personal_data_erased_at is null then t.attendee_phone else null end) else '{}'::jsonb end
    else public.integration_ticket_projection(t,o) end value
   from public.integration_attributed_orders(app,org,p_mode,p_event,case when p_operation='tickets' then p_resource else null end) o
   join public.order_items i on i.order_id=o.id join public.tickets t on t.order_item_id=i.id and t.event_id=o.event_id
   where (p_operation<>'ticket' or t.id=p_resource) and (p_after is null or t.id>p_after)
    and (p_operation<>'attendees' or (t.claim_state<>'UNCLAIMED' and public.integration_order_verified(o.id)))
   order by t.id limit p_limit+1) page;
 elsif p_operation='groups' then
  select coalesce(jsonb_agg(value order by id),'[]'::jsonb) into rows from (
   select g.id,jsonb_build_object('id',g.id,'order_id',o.id,'event_id',o.event_id,'ticket_type_id',i.ticket_type_id,
    'admissions',g.admissions,'registered_admissions',(select count(*) from public.tickets where group_booking_id=g.id and claim_state<>'UNCLAIMED'),
    'unclaimed_admissions',(select count(*) from public.tickets where group_booking_id=g.id and claim_state='UNCLAIMED'),
    'checked_in_admissions',(select count(*) from public.tickets where group_booking_id=g.id and claim_state='CHECKED_IN'),
    'claimable_admissions',case when o.personal_data_erased_at is null and public.integration_order_verified(o.id) and o.status in ('paid','partially_refunded')
      and exists(select 1 from public.events where id=o.event_id and status='published' and ends_at>now()) then
     (select count(*) from public.tickets where group_booking_id=g.id and claim_state='UNCLAIMED' and status='valid') else 0 end) value
   from public.integration_attributed_orders(app,org,p_mode,p_event,p_resource) o join public.order_items i on i.order_id=o.id
   join public.group_bookings g on g.order_item_id=i.id where (p_after is null or g.id>p_after)
   order by g.id limit p_limit+1) page;
 elsif p_operation='refunds' then
  select coalesce(jsonb_agg(value order by id),'[]'::jsonb) into rows from (
   select r.id,jsonb_build_object('id',r.id,'order_id',o.id,'status',r.status,'amount_kobo',r.amount_kobo,
    'currency',o.currency,'created_at',r.created_at,'confirmed_at',r.provider_confirmed_at) value
   from public.integration_attributed_orders(app,org,p_mode,p_event,p_resource) o join public.refunds r on r.order_id=o.id
   where (p_after is null or r.id>p_after) order by r.id limit p_limit+1) page;
 else
  with eligible as (select o.* from public.integration_attributed_orders(app,org,p_mode,p_event) o
   where public.integration_order_verified(o.id)), totals as (
   select count(*) orders,coalesce(sum(total_kobo),0) payments,coalesce(sum(subtotal_kobo-discount_kobo),0) tickets,
    coalesce(sum(fee_kobo),0) fees from eligible), refunds as (
   select coalesce(sum(r.amount_kobo),0) refunded from public.refunds r join eligible o on o.id=r.order_id
    where r.status='completed' and r.provider_confirmed_at is not null)
  select jsonb_build_array(jsonb_build_object('event_id',p_event,'currency','NGN','verified_orders',totals.orders,
   'ticket_subtotal_kobo',totals.tickets,'service_fees_charged_kobo',totals.fees,'customer_payments_kobo',totals.payments,
   'completed_refunds_kobo',refunds.refunded,'net_customer_payments_kobo',greatest(0,totals.payments-refunds.refunded),
   'sold_admissions',(select count(*) from eligible o join public.order_items i on i.order_id=o.id
     join public.tickets t on t.order_item_id=i.id where t.event_id=o.event_id and t.status in ('valid','used') and o.status in ('paid','partially_refunded')),
   'as_of',now(),'application_attributed_only',true)) into rows from totals,refunds;
 end if;
 return jsonb_build_object('rows',rows);
end; $$;

create table public.integration_entry_requests (
 id uuid primary key default gen_random_uuid(), integration_id uuid not null references public.integrations(id),
 environment text not null check(environment in ('test','live')), event_id uuid not null references public.events(id),
 key_id uuid not null references public.integration_api_keys(id), ticket_id uuid not null references public.tickets(id),
 actor_id uuid not null references public.profiles(id), idempotency_digest text not null check(idempotency_digest ~ '^[a-f0-9]{64}$'),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'), result jsonb not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 unique(integration_id,environment,idempotency_digest)
);
alter table public.integration_entry_requests enable row level security;
revoke all on public.integration_entry_requests from public,anon,authenticated;
grant all on public.integration_entry_requests to service_role;

create function public.perform_integration_entry(p_key uuid,p_digest text,p_mode text,p_event uuid,p_code text,p_admit boolean,
 p_idempotency_digest text,p_payload_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb; app uuid; org uuid; actor uuid; ticket_id uuid; order_id uuid;
 previous public.integration_entry_requests%rowtype; result jsonb; safe_result jsonb;
begin
 if p_admit is null or p_code is null or p_code !~ '^NT-[A-F0-9]{12}$'
  or p_idempotency_digest is null or p_idempotency_digest !~ '^[a-f0-9]{64}$'
  or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid entry request.' using errcode='NT400'; end if;
 identity:=public.require_integration_event_reader(p_key,p_digest,p_mode,'entry:verify');
 if p_admit and not ((identity->'scopes')?'entry:check-in') then raise exception 'Insufficient scope.' using errcode='NT403'; end if;
 app:=(identity->>'integrationId')::uuid; org:=(identity->>'organiserId')::uuid;
 -- App lock serialises absent idempotency rows. Current issuer is the delegated
 -- principal, never an arbitrary staff/customer ID supplied by a partner.
 -- NO KEY UPDATE serialises requests/config changes while allowing the existing
 -- refund/payment outbox's foreign-key KEY SHARE; FOR UPDATE would deadlock.
 perform 1 from public.integrations where id=app for no key update;
 perform 1 from public.integration_api_keys where id=p_key for share;
 select created_by into actor from public.integration_api_keys where id=p_key;
 perform 1 from public.organiser_memberships where organiser_id=org and user_id=actor for share;
 perform 1 from public.integration_event_grants where integration_id=app and event_id=p_event for share;
 identity:=public.require_integration_event_reader(p_key,p_digest,p_mode,'entry:verify');
 if p_admit and not ((identity->'scopes')?'entry:check-in') then raise exception 'Insufficient scope.' using errcode='NT403'; end if;
 perform 1 from public.events where id=p_event for share;
 if not exists(select 1 from public.events e join public.integration_event_grants g on g.event_id=e.id
    where e.id=p_event and e.organiser_id=org and g.integration_id=app and g.organiser_id=org and e.status='published' and e.ends_at>now()) then
  raise exception 'Resource not found.' using errcode='NT404'; end if;
 select t.id,o.id into ticket_id,order_id from public.integration_attributed_orders(app,org,p_mode,p_event) o
  join public.order_items i on i.order_id=o.id join public.tickets t on t.order_item_id=i.id
  where t.event_id=p_event and t.display_code=p_code and t.claim_state<>'UNCLAIMED';
 if ticket_id is null then raise exception 'Resource not found.' using errcode='NT404'; end if;
 select * into previous from public.integration_entry_requests where integration_id=app and environment=p_mode
   and idempotency_digest=p_idempotency_digest;
 if found then
  if previous.payload_hash<>p_payload_hash or previous.event_id<>p_event or previous.ticket_id<>ticket_id then
   raise exception 'Entry idempotency conflict.' using errcode='NT409'; end if;
  if previous.expires_at<=now() then raise exception 'Entry replay expired.' using errcode='NT410'; end if;
  return previous.result||jsonb_build_object('replayed',true);
 end if;
 delete from public.integration_entry_requests where id in(select id from public.integration_entry_requests
   where integration_id=app and expires_at<now() order by expires_at limit 100);
 if (select count(*) from public.integration_entry_requests where integration_id=app)>=10000 then
  raise exception 'Entry history limit reached.' using errcode='NT409'; end if;
 -- This is the existing venue engine: it checks issuer/event membership,
 -- verified payment and refunds, locks order/ticket and enforces one admission.
 if not public.integration_order_verified(order_id) and exists(select 1 from public.orders where id=order_id and status in ('paid','partially_refunded')) then
  result:=jsonb_build_object('outcome','unpaid','admitted',false);
 else
  result:=public.verify_event_entry(actor,p_event,p_code,p_admit);
 end if;
 safe_result:=jsonb_build_object('ticket_id',ticket_id,'event_id',p_event,'outcome',result->>'outcome',
  'admitted',coalesce((result->>'admitted')::boolean,false),'admission_limit',1,
  'admissions_used',coalesce((result->>'admissionsUsed')::integer,0),'checked_in_at',result->'checkedInAt','replayed',false);
 insert into public.integration_entry_requests(integration_id,environment,event_id,key_id,ticket_id,actor_id,idempotency_digest,payload_hash,result)
  values(app,p_mode,p_event,p_key,ticket_id,actor,p_idempotency_digest,p_payload_hash,safe_result);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(actor,case when p_admit then 'integration.ticket_check_in' else 'integration.ticket_verified' end,'ticket',ticket_id::text,
   jsonb_build_object('integration_id',app,'key_id',p_key,'event_id',p_event,'environment',p_mode,'outcome',result->>'outcome'));
 return safe_result;
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('integration_attributed_orders','integration_order_verified','integration_order_projection',
 'integration_ticket_projection','read_integration_operations','perform_integration_entry') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.name in ('read_integration_operations','perform_integration_entry') then
  execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end; $$;

-- Extend the existing distributed limiter; preserve all prior bucket forms.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.consume_integration_rate_limit(text,integer,integer)'::regprocedure);
 if position('global:v1|' in definition)=0 then raise exception 'Unexpected limiter definition.'; end if;
 definition:=replace(definition,'global:v1|','entry:(key|org):[a-f0-9-]{36}|global:v1|');
 execute definition;
end $$;

-- Compatibility/privacy fix found during Phase 6 rehearsal: the original guest
-- eraser predates unclaimed slots and attendee phones. Keep unclaimed identity
-- columns null, remove contact keys/phone on claimed slots, and block new claims
-- after erasure so an old invite cannot repopulate personal information.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.anonymize_guest_order_personal_data(uuid,text)'::regprocedure);
 if position('attendee_email = privacy_email' in definition)=0
  or position('and order_item.order_id = locked_order.id' in definition)=0 then
  raise exception 'Unexpected guest privacy routine.'; end if;
 definition:=replace(definition,'attendee_email = privacy_email',
  'attendee_email = privacy_email, attendee_phone = null, claim_email_key = null, claim_phone_key = null');
 definition:=replace(definition,'and order_item.order_id = locked_order.id',
  'and order_item.order_id = locked_order.id and ticket.claim_state <> ''UNCLAIMED''');
 execute definition;
 definition:=pg_get_functiondef('public.claim_group_ticket(text,text,text,text)'::regprocedure);
 if position('if order_row.status not in' in definition)=0 then raise exception 'Unexpected group claim routine.'; end if;
 definition:=replace(definition,'if order_row.status not in','if order_row.personal_data_erased_at is not null or order_row.status not in');
 execute definition;
end $$;
