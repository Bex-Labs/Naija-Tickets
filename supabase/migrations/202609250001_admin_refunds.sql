-- Administrator accounts are private platform credentials, not auth.users.
-- Preserve customer-requested refunds while recording the admin actor separately.
alter table public.refunds
  alter column requested_by drop not null,
  add column admin_actor_id text,
  add column provider_refund_id text,
  add column provider_status text,
  add column updated_at timestamptz not null default now(),
  add constraint refunds_requester_present check (num_nonnulls(requested_by, admin_actor_id) = 1);

create unique index refunds_provider_refund_id_unique
  on public.refunds (provider_refund_id) where provider_refund_id is not null;
create index refunds_order_status_idx on public.refunds (order_id, status);

-- Only the server role may call this function. The HTTP route authenticates
-- the admin and fetches the refund directly from Paystack before calling it.
create function public.record_admin_refund(
  p_order_id uuid,
  p_provider_refund_id text,
  p_provider_transaction_id text,
  p_amount_kobo bigint,
  p_currency text,
  p_provider_status text,
  p_reason text,
  p_admin_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  payment_row public.payments%rowtype;
  refund_row public.refunds%rowtype;
  previous_status public.refund_status;
  completed_kobo bigint;
  active_kobo bigint;
  new_status public.refund_status;
  is_new boolean := false;
begin
  if p_provider_refund_id !~ '^[0-9]{1,20}$'
    or p_amount_kobo is null or p_amount_kobo <= 0
    or p_currency <> 'NGN'
    or p_provider_status not in ('pending', 'processing', 'needs-attention', 'processed', 'failed')
    or p_admin_actor_id is null or length(btrim(p_admin_actor_id)) not between 1 and 100 then
    raise exception 'Invalid refund details.' using errcode = '22023';
  end if;

  -- This lock serialises refund accounting with concurrent refund records and
  -- entry scans (which take a share lock on the same order).
  select * into order_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = '22023';
  end if;
  select * into payment_row from public.payments
    where order_id = p_order_id and provider = 'paystack' and status in ('verified', 'refunded')
    order by verified_at desc nulls last, created_at desc limit 1;
  if payment_row.id is null
    or payment_row.provider_transaction_id is distinct from p_provider_transaction_id
    or payment_row.amount_kobo <> order_row.total_kobo
    or payment_row.currency <> order_row.currency
    or order_row.total_kobo <= 0 then
    raise exception 'This order has no matching verified Paystack payment.' using errcode = '22023';
  end if;

  select * into refund_row from public.refunds
    where provider_refund_id = p_provider_refund_id for update;
  if refund_row.id is not null and (
    refund_row.order_id <> p_order_id or refund_row.amount_kobo <> p_amount_kobo
  ) then
    raise exception 'This Paystack refund belongs to another transaction or amount.' using errcode = '22023';
  end if;
  if refund_row.id is null then
    if order_row.status not in ('paid', 'partially_refunded')
      or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then
      raise exception 'An eligible paid order and a reason are required.' using errcode = '22023';
    end if;
    if exists (select 1 from public.refunds
      where order_id = p_order_id and status in ('requested', 'approved', 'processing')) then
      raise exception 'Finish the existing refund before recording another.' using errcode = '22023';
    end if;
    is_new := true;
  end if;

  select coalesce(sum(coalesce(amount_kobo, order_row.total_kobo)), 0)::bigint
    into completed_kobo from public.refunds
    where order_id = p_order_id and status = 'completed'
      and (refund_row.id is null or id <> refund_row.id);
  select coalesce(sum(coalesce(amount_kobo, order_row.total_kobo)), 0)::bigint
    into active_kobo from public.refunds
    where order_id = p_order_id and status in ('requested', 'approved', 'processing')
      and (refund_row.id is null or id <> refund_row.id);
  if completed_kobo + active_kobo + p_amount_kobo > order_row.total_kobo then
    raise exception 'Refund amount exceeds the remaining payment.' using errcode = '22023';
  end if;

  new_status := case p_provider_status
    when 'processed' then 'completed'::public.refund_status
    when 'failed' then 'failed'::public.refund_status
    else 'processing'::public.refund_status
  end;
  previous_status := refund_row.status;
  if refund_row.status = 'completed' and new_status <> 'completed' then
    new_status := 'completed';
  end if;

  if is_new then
    insert into public.refunds(order_id, requested_by, admin_actor_id, reason,
      amount_kobo, status, provider_refund_id, provider_status,
      provider_confirmed_at)
    values(p_order_id, null, p_admin_actor_id, btrim(p_reason), p_amount_kobo,
      new_status, p_provider_refund_id, p_provider_status,
      case when new_status = 'completed' then now() else null end)
    returning * into refund_row;
  else
    update public.refunds set status = new_status,
      provider_status = case when status = 'completed' then provider_status else p_provider_status end,
      provider_confirmed_at = case when new_status = 'completed'
        then coalesce(provider_confirmed_at, now()) else null end,
      updated_at = now()
    where id = refund_row.id returning * into refund_row;
  end if;

  select coalesce(sum(coalesce(amount_kobo, order_row.total_kobo)), 0)::bigint
    into completed_kobo from public.refunds
    where order_id = p_order_id and status = 'completed';
  select coalesce(sum(coalesce(amount_kobo, order_row.total_kobo)), 0)::bigint
    into active_kobo from public.refunds
    where order_id = p_order_id and status in ('requested', 'approved', 'processing');
  if completed_kobo >= order_row.total_kobo then
    update public.orders set status = 'refunded', updated_at = now() where id = p_order_id;
    update public.payments set status = 'refunded', updated_at = now() where id = payment_row.id;
    update public.tickets set status = 'refunded'
      where status = 'valid' and order_item_id in
        (select id from public.order_items where order_id = p_order_id);
  elsif completed_kobo > 0 then
    update public.orders set status = 'partially_refunded', updated_at = now()
      where id = p_order_id and status <> 'partially_refunded';
  end if;

  if is_new or previous_status is distinct from new_status then
    insert into public.audit_logs(action, entity_type, entity_id, metadata)
      values(case when is_new then 'admin.refund_recorded'
        else 'refund.status_reconciled' end, 'refund', refund_row.id::text,
        jsonb_build_object('actor_admin_id', p_admin_actor_id,
          'order_id', p_order_id, 'amount_kobo', p_amount_kobo,
          'provider_refund_id', p_provider_refund_id, 'provider_status', p_provider_status));
  end if;
  return jsonb_build_object('id', refund_row.id, 'status', refund_row.status,
    'providerStatus', refund_row.provider_status, 'amountKobo', refund_row.amount_kobo,
    'refundedKobo', completed_kobo, 'processingKobo', active_kobo,
    'remainingKobo', greatest(0, order_row.total_kobo - completed_kobo - active_kobo));
end;
$$;

-- Keep the list query bounded to the 25 transactions already selected by the
-- admin route. Refund details never become available to public API roles.
create function public.admin_refund_summaries(p_order_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', o.id,
    'refundedKobo', coalesce(ra.completed_kobo, 0),
    'processingKobo', coalesce(ra.processing_kobo, 0),
    'remainingKobo', greatest(0, o.total_kobo - coalesce(ra.completed_kobo, 0) - coalesce(ra.processing_kobo, 0)),
    'canRecordRefund', o.status in ('paid', 'partially_refunded')
      and o.total_kobo > coalesce(ra.completed_kobo, 0)
      and coalesce(ra.processing_kobo, 0) = 0
      and exists (select 1 from public.payments p
        where p.order_id = o.id and p.provider = 'paystack' and p.status = 'verified'
          and p.provider_transaction_id is not null
          and p.amount_kobo = o.total_kobo and p.currency = o.currency),
    'refunds', coalesce(ra.items, '[]'::jsonb)
  )), '[]'::jsonb)
  from public.orders o
  left join lateral (
    select coalesce(sum(coalesce(r.amount_kobo, o.total_kobo))
      filter (where r.status = 'completed'), 0)::bigint as completed_kobo,
      coalesce(sum(coalesce(r.amount_kobo, o.total_kobo))
      filter (where r.status in ('requested', 'approved', 'processing')), 0)::bigint as processing_kobo,
      jsonb_agg(jsonb_build_object('id', r.id, 'amountKobo', r.amount_kobo,
        'status', r.status, 'providerRefundId', r.provider_refund_id,
        'providerStatus', r.provider_status, 'reason', r.reason,
        'createdAt', r.created_at, 'confirmedAt', r.provider_confirmed_at)
        order by r.created_at desc, r.id desc) as items
    from public.refunds r where r.order_id = o.id
  ) ra on true
  where o.id = any(p_order_ids) and coalesce(array_length(p_order_ids, 1), 0) <= 25;
$$;

revoke all on function public.record_admin_refund(uuid,text,text,bigint,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_admin_refund(uuid,text,text,bigint,text,text,text,text)
  to service_role;
revoke all on function public.admin_refund_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_refund_summaries(uuid[]) to service_role;
