-- Only trusted server code imports provider settlements; browsers cannot mark money paid.
alter table public.payouts
  add column provider_settlement_id text,
  add column provider_subaccount_code text,
  add column provider_updated_at timestamptz,
  add column synced_at timestamptz;
create unique index payouts_provider_settlement_unique
  on public.payouts(provider_subaccount_code, provider_settlement_id)
  where provider_settlement_id is not null;
create table public.payout_payments (
  payment_id uuid primary key references public.payments(id),
  payout_id uuid not null references public.payouts(id)
);
alter table public.payout_payments enable row level security;
revoke all on public.payout_payments from public, anon, authenticated;
grant all on public.payout_payments to service_role;
create table public.payout_sync_state (
  organiser_id uuid not null references public.organisers(id),
  subaccount_code text not null,
  checked_at timestamptz,
  last_synced_at timestamptz,
  next_attempt_at timestamptz,
  needs_attention boolean not null default false,
  primary key (organiser_id, subaccount_code)
);
alter table public.payout_sync_state enable row level security;
revoke all on public.payout_sync_state from public, anon, authenticated;
grant all on public.payout_sync_state to service_role;

create function public.payout_sync_accounts(p_user_id uuid)
returns table(organiser_id uuid, subaccount_code text, last_synced_at timestamptz, needs_attention boolean)
language sql stable security definer set search_path = '' as $$
  with owned as (
    select distinct m.organiser_id from public.organiser_memberships m where m.user_id=p_user_id
  ), codes as (
    select a.organiser_id, a.provider_subaccount_code as code from public.organiser_payout_accounts a join owned o on o.organiser_id=a.organiser_id
    union
    select e.organiser_id, p.provider_subaccount_code from public.payments p
      join public.orders ord on ord.id=p.order_id join public.events e on e.id=ord.event_id
      join owned o on o.organiser_id=e.organiser_id
      where p.provider='paystack' and p.provider_subaccount_code is not null
  )
  select c.organiser_id,c.code,s.last_synced_at,coalesce(s.needs_attention,false)
    from codes c left join public.payout_sync_state s on s.organiser_id=c.organiser_id and s.subaccount_code=c.code;
$$;
create function public.claim_payout_sync(p_organiser_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.payout_sync_state(organiser_id,subaccount_code) values(p_organiser_id,p_code) on conflict do nothing;
  update public.payout_sync_state set next_attempt_at=now()+interval '1 minute', checked_at=now()
    where organiser_id=p_organiser_id and subaccount_code=p_code and (next_attempt_at is null or next_attempt_at<=now());
  return found;
end;
$$;

create function public.record_paystack_settlement(
  p_organiser_id uuid, p_code text, p_settlement jsonb, p_transactions jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_payout_id uuid;
  previous public.payouts%rowtype;
  matched_count integer;
  gross bigint;
  start_date date;
  end_date date;
  state public.payout_status;
  settlement_id text := p_settlement->>'id';
  provider_updated timestamptz := (p_settlement->>'updatedAt')::timestamptz;
begin
  -- Serialise imports for this organiser, including overlapping refresh requests.
  perform 1 from public.organisers where id=p_organiser_id for update;
  if not found then raise exception 'Unknown organiser'; end if;
  if settlement_id is null or settlement_id !~ '^[1-9][0-9]{0,19}$' or p_code is null or p_code !~ '^ACCT_[A-Za-z0-9]+$'
    or p_settlement->>'status' not in ('pending','processing','paid','failed')
    or jsonb_typeof(p_transactions) <> 'array' or jsonb_array_length(p_transactions)=0
    or provider_updated is null or p_settlement->>'date' is null
    or p_settlement->>'grossKobo' is null or p_settlement->>'feesKobo' is null or p_settlement->>'amountKobo' is null then
    raise exception 'Invalid settlement';
  end if;
  state := (p_settlement->>'status')::public.payout_status;
  if (select count(distinct x->>'reference') from jsonb_array_elements(p_transactions) x) <> jsonb_array_length(p_transactions) then
    raise exception 'Duplicate settlement transaction';
  end if;
  select count(*), coalesce(sum(o.subtotal_kobo-o.discount_kobo),0), min((coalesce(p.verified_at,p.created_at) at time zone 'Africa/Lagos')::date),max((coalesce(p.verified_at,p.created_at) at time zone 'Africa/Lagos')::date)
    into matched_count,gross,start_date,end_date
    from jsonb_array_elements(p_transactions) x
    join public.payments p on p.provider_reference=x->>'reference' and p.provider='paystack'
    join public.orders o on o.id=p.order_id join public.events e on e.id=o.event_id
    where e.organiser_id=p_organiser_id and p.provider_subaccount_code=p_code
      and p.status in ('verified','refunded') and o.status in ('paid','partially_refunded','refunded')
      and coalesce(p.raw_verification#>>'{data,domain}',p.raw_verification->>'domain')='live'
      and p.currency='NGN' and p.amount_kobo=(x->>'amountKobo')::bigint
      and p.amount_kobo=o.total_kobo
      and p.platform_transaction_charge_kobo=o.fee_kobo;
  if matched_count <> jsonb_array_length(p_transactions) or gross<>(p_settlement->>'grossKobo')::bigint
    or gross<>(p_settlement->>'amountKobo')::bigint+(p_settlement->>'feesKobo')::bigint then
    raise exception 'Settlement does not reconcile with verified organiser sales';
  end if;
  select * into previous from public.payouts where provider_subaccount_code=p_code and provider_settlement_id=settlement_id for update;
  if found then
    if previous.organiser_id<>p_organiser_id then raise exception 'Settlement owner mismatch'; end if;
    if previous.provider_updated_at>provider_updated then return previous.id; end if;
    if previous.status='paid' and state<>'paid' then raise exception 'A completed settlement cannot be downgraded'; end if;
    if previous.status='paid' and (previous.gross_kobo<>gross or previous.net_kobo<>(p_settlement->>'amountKobo')::bigint or previous.fees_kobo<>(p_settlement->>'feesKobo')::bigint) then
      raise exception 'Completed settlement amount changed; reconciliation required';
    end if;
  end if;
  -- Legacy records cannot be safely matched to batches without their provider reference.
  if exists(select 1 from public.payouts where organiser_id=p_organiser_id and provider_settlement_id is null and status<>'failed') then
    raise exception 'Existing manual payouts need reconciliation before automatic import';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_transactions) x join public.payments p on p.provider='paystack' and p.provider_reference=x->>'reference'
    join public.payout_payments pp on pp.payment_id=p.id join public.payouts other on other.id=pp.payout_id
    where other.id is distinct from previous.id and other.status<>'failed'
  ) then raise exception 'Payment already belongs to another payout'; end if;
  insert into public.payouts(organiser_id,period_start,period_end,gross_kobo,fees_kobo,refunds_kobo,net_kobo,status,paid_at,scheduled_at,reference,provider_settlement_id,provider_subaccount_code,provider_updated_at,synced_at)
    values(p_organiser_id,start_date,end_date,gross,(p_settlement->>'feesKobo')::bigint,0,(p_settlement->>'amountKobo')::bigint,state,
      case when state='paid' then (p_settlement->>'date')::timestamptz end,
      case when state in ('pending','processing') then (p_settlement->>'date')::timestamptz end,
      'PS-'||settlement_id||'-'||p_code,settlement_id,p_code,provider_updated,now())
    on conflict (provider_subaccount_code,provider_settlement_id) where provider_settlement_id is not null do update
      set gross_kobo=excluded.gross_kobo,fees_kobo=excluded.fees_kobo,net_kobo=excluded.net_kobo,status=excluded.status,
        paid_at=excluded.paid_at,scheduled_at=excluded.scheduled_at,provider_updated_at=excluded.provider_updated_at,synced_at=now()
    returning id into saved_payout_id;
  delete from public.payout_payments pp where pp.payout_id=saved_payout_id
    and not exists(select 1 from jsonb_array_elements(p_transactions) x
      join public.payments p on p.provider='paystack' and p.provider_reference=x->>'reference'
      where p.id=pp.payment_id);
  insert into public.payout_payments(payment_id,payout_id)
    select p.id,saved_payout_id from jsonb_array_elements(p_transactions) x
      join public.payments p on p.provider='paystack' and p.provider_reference=x->>'reference'
    on conflict(payment_id) do update set payout_id=excluded.payout_id;
  return saved_payout_id;
end;
$$;
revoke all on function public.payout_sync_accounts(uuid), public.claim_payout_sync(uuid,text), public.record_paystack_settlement(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.payout_sync_accounts(uuid), public.claim_payout_sync(uuid,text), public.record_paystack_settlement(uuid,text,jsonb,jsonb) to service_role;

-- Include refunded orders so historical payouts remain traceable.
create or replace function public.organiser_payout_tracking_v2(p_user_id uuid, p_live boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with owned_orgs as (
    select distinct organiser_id from public.organiser_memberships
    where user_id = p_user_id
  ),
  verified_orders as (
    select o.id, o.subtotal_kobo, o.discount_kobo,
      least(greatest(0, o.subtotal_kobo - o.discount_kobo),
        coalesce((select sum(coalesce(r.amount_kobo, o.subtotal_kobo - o.discount_kobo))
          from public.refunds r
          where r.order_id = o.id and r.status = 'completed'), 0)) as refunded_kobo
    from public.orders o
    join public.events e on e.id = o.event_id
    join owned_orgs org on org.organiser_id = e.organiser_id
    where o.status in ('paid', 'partially_refunded', 'refunded')
      and exists (select 1 from public.payments p
        where p.order_id = o.id and p.status in ('verified','refunded')
          and (not p_live or coalesce(p.raw_verification#>>'{data,domain}',p.raw_verification->>'domain')='live'))
  ),
  sales as (
    select coalesce(sum(subtotal_kobo), 0)::bigint as gross,
      coalesce(sum(discount_kobo), 0)::bigint as discounts,
      coalesce(sum(refunded_kobo), 0)::bigint as refunds
    from verified_orders
  ),
  recorded as (
    select p.* from public.payouts p
    join owned_orgs org on org.organiser_id = p.organiser_id
  ),
  payout_totals as (
    select coalesce(sum(fees_kobo) filter (where status <> 'failed'), 0)::bigint as fees,
      coalesce(sum(net_kobo) filter (where status = 'paid'), 0)::bigint as paid,
      coalesce(sum(net_kobo) filter (where status in ('approved', 'processing') and scheduled_at is not null), 0)::bigint as scheduled,
      coalesce(sum(net_kobo) filter (where status in ('approved', 'processing') and scheduled_at is null), 0)::bigint as approved,
      coalesce(sum(net_kobo) filter (where status = 'pending'), 0)::bigint as pending
    from recorded
  )
  select jsonb_build_object(
    'grossSalesKobo', s.gross,
    'discountsKobo', s.discounts,
    'refundsKobo', s.refunds,
    'payoutFeesKobo', p.fees,
    'eligibleKobo', s.gross - s.discounts - s.refunds - p.fees,
    'paidKobo', p.paid,
    'scheduledKobo', p.scheduled,
    'approvedKobo', p.approved,
    'pendingKobo', p.pending,
    'unallocatedKobo', s.gross - s.discounts - s.refunds - p.fees - p.paid - p.scheduled - p.approved - p.pending,
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'organiserName', org.name, 'reference', h.reference,
        'status', h.status, 'amountKobo', h.net_kobo,
        'grossKobo', h.gross_kobo, 'feesKobo', h.fees_kobo,
        'refundsKobo', h.refunds_kobo, 'periodStart', h.period_start,
        'periodEnd', h.period_end, 'scheduledAt', h.scheduled_at,
        'paidAt', h.paid_at, 'createdAt', h.created_at,
        'automatic', h.provider_settlement_id is not null, 'syncedAt', h.synced_at
      ) order by h.created_at desc, h.id desc)
      from (select * from recorded order by created_at desc, id desc limit 100) h
      join public.organisers org on org.id = h.organiser_id
    ), '[]'::jsonb)
  ) from sales s cross join payout_totals p;
$$;

revoke all on function public.organiser_payout_tracking_v2(uuid,boolean) from public, anon, authenticated;
grant execute on function public.organiser_payout_tracking_v2(uuid,boolean) to service_role;
