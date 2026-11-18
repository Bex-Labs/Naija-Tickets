-- Reporting does not calculate every historical session's ticket snapshot.
-- Aggregate verified payment states in one set and expand only the recent 50.
create index integration_checkout_created_idx on public.integration_checkout_sessions(integration_id,created_at desc,id desc);
create or replace function public.integration_hosted_report(p_app uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with app as(select * from public.integrations where id=p_app),
 session_base as(select s.*,o.status order_status,o.reservation_expires_at from public.integration_checkout_sessions s
 left join public.orders o on o.id=s.order_id where s.integration_id=p_app and s.created_at>=now()-interval '30 days'),
 payment_states as(select p.order_id,bool_or(p.status in ('verified','refunded')) verified,
 bool_or(p.status in ('initialized','pending')) pending,bool_or(p.status in ('failed','abandoned')) failed
 from public.payments p join session_base s on s.order_id=p.order_id group by p.order_id),
 sessions as(select s.*,jsonb_build_object('status',case
 when s.order_status in ('paid','refunded','partially_refunded') and p.verified then s.order_status::text
 when s.cancelled_at is not null then 'cancelled'
 when s.expires_at<=now() or s.order_status='expired' or (s.order_status='pending' and s.reservation_expires_at<=now()) then 'expired'
 when s.order_status in ('failed','abandoned') then 'failed'
 when s.order_id is null then 'open' when p.pending then 'pending' when p.failed then 'failed' else 'reserved' end) snapshot
 from session_base s left join payment_states p on p.order_id=s.order_id),
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
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'eventId',event_id,'createdAt',created_at,'status',snapshot->>'status','orderId',order_id,'admissions',full_snapshot->'admissions','totalKobo',full_snapshot->'total_kobo','source',case when hosted_link_id is not null then 'hosted_link' when widget_configuration_id is not null then 'legacy_widget' else 'hosted_api' end) order by created_at desc,id desc)
 from(select q.*,public.integration_checkout_snapshot(q.id) full_snapshot from (select * from sessions order by created_at desc,id desc limit 50) q) recent),'[]'::jsonb));
$$;
revoke all on function public.integration_hosted_report(uuid) from public,anon,authenticated;
grant execute on function public.integration_hosted_report(uuid) to service_role;

-- Present actual remaining package inventory separately from per-order limits.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.hosted_checkout_details(uuid,text)'::regprocedure);
 if position('''max_packages'',(availability->>''max_packages_at_current_price'')::integer' in definition)=0 then raise exception 'Unexpected checkout catalogue definition.'; end if;
 execute replace(definition,'''max_packages'',(availability->>''max_packages_at_current_price'')::integer',
   '''max_packages'',(availability->>''max_packages_at_current_price'')::integer,''remaining_packages'',(availability->>''remaining_packages'')::integer');
end $$;

-- Prefill is temporary transport data, not a second customer record. Once an
-- order exists, its existing contact/privacy lifecycle becomes authoritative.
create function public.clear_consumed_hosted_prefill() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.order_id is not null then new.customer_prefill:='{}'::jsonb; end if;
 return new;
end; $$;
create trigger hosted_prefill_consumed before update of order_id on public.integration_checkout_sessions
 for each row execute function public.clear_consumed_hosted_prefill();
create index hosted_prefill_expiry_idx on public.integration_checkout_sessions(expires_at,id) where customer_prefill<>'{}'::jsonb;
create function public.purge_hosted_prefill(p_mode text,p_limit integer default 1000) returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 perform public.require_integration_resource_mode(p_mode);
 if p_limit is null or p_limit not between 1 and 5000 then raise exception 'Invalid cleanup limit.' using errcode='NT400'; end if;
 update public.integration_checkout_sessions s set customer_prefill='{}'::jsonb where s.id in
 (select id from public.integration_checkout_sessions where environment=p_mode and customer_prefill<>'{}'::jsonb
 and (order_id is not null or expires_at<=now()) order by expires_at,id limit p_limit for update skip locked);
 get diagnostics changed=row_count;return changed;
end; $$;
revoke all on function public.clear_consumed_hosted_prefill(),public.purge_hosted_prefill(text,integer) from public,anon,authenticated;
grant execute on function public.purge_hosted_prefill(text,integer) to service_role;
-- Opportunistically clear expired prefill during active API traffic. The
-- existing authenticated daily dispatcher performs bounded dormant cleanup.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.create_hosted_session_v2(uuid,text,text,uuid,uuid,jsonb,text,text,text,text,text,text,text,text,timestamp with time zone,jsonb,text)'::regprocedure);
 if position(' return public.integration_checkout_snapshot' in definition)=0 then raise exception 'Unexpected session wrapper.'; end if;
 execute replace(definition,' return public.integration_checkout_snapshot',' perform public.purge_hosted_prefill(p_environment,50); return public.integration_checkout_snapshot');
end $$;
