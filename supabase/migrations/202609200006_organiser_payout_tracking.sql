-- References and dates make manually reconciled payout records traceable.
alter table public.payouts
  add column reference text,
  add column scheduled_at timestamptz;

update public.payouts
set reference = 'PO-' || upper(replace(id::text, '-', ''))
where reference is null;

alter table public.payouts
  alter column reference set default 'PO-' || upper(replace(gen_random_uuid()::text, '-', '')),
  alter column reference set not null,
  add constraint payouts_reference_unique unique (reference),
  add constraint payouts_net_reconciles check (
    net_kobo >= 0 and net_kobo = gross_kobo - fees_kobo - refunds_kobo
  ),
  add constraint payouts_paid_date check (status <> 'paid' or paid_at is not null);

create index payouts_organiser_created_idx
  on public.payouts (organiser_id, created_at desc, id desc);

-- The route authenticates the session; this function independently scopes every
-- sale and payout to organisations of that user. Only service_role may call it.
create function public.organiser_payout_tracking(p_user_id uuid)
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
    where o.status in ('paid', 'partially_refunded')
      and exists (select 1 from public.payments p
        where p.order_id = o.id and p.status = 'verified')
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
        'paidAt', h.paid_at, 'createdAt', h.created_at
      ) order by h.created_at desc, h.id desc)
      from (select * from recorded order by created_at desc, id desc limit 100) h
      join public.organisers org on org.id = h.organiser_id
    ), '[]'::jsonb)
  ) from sales s cross join payout_totals p;
$$;

revoke all on function public.organiser_payout_tracking(uuid) from public, anon, authenticated;
grant execute on function public.organiser_payout_tracking(uuid) to service_role;
