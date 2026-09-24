-- Admin-only transaction monitor. The API authenticates the administrator
-- before invoking this service-role-only function.
create function public.admin_transactions(
  p_search text default '',
  p_status text default 'all',
  p_method text default 'all',
  p_page integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if length(p_search) > 100
    or p_status not in ('all', 'verified', 'pending', 'failed', 'abandoned', 'expired', 'refunded', 'partially_refunded', 'needs_review')
    or p_method not in ('all', 'paystack', 'demo_free')
    or p_page not between 1 and 10000 then
    raise exception 'Invalid transaction filters.';
  end if;

  with transactions as (
    select o.id, o.reference, o.created_at, o.total_kobo, o.currency,
      o.status::text as order_status,
      case when o.personal_data_erased_at is not null then 'Guest buyer (details erased)'
        else coalesce(nullif(o.purchaser_name, ''), 'Unknown customer') end as customer_name,
      case when o.personal_data_erased_at is not null then null
        else o.purchaser_email end as customer_email,
      e.title as event_title,
      p.provider, p.provider_reference, p.status::text as payment_status,
      p.verified_at,
      case
        when p.provider = 'demo_free' then 'Free booking'
        when p.provider = 'paystack' then
          coalesce(nullif(p.raw_verification #>> '{data,channel}', ''), 'Paystack (method unavailable)')
        else 'No payment method'
      end as payment_method,
      case
        when o.status = 'refunded' and p.status in ('verified', 'refunded') then 'refunded'
        when o.status = 'partially_refunded' and p.status = 'verified' then 'partially_refunded'
        when o.status = 'paid' and p.status = 'verified' then 'verified'
        when o.status in ('paid', 'partially_refunded', 'refunded') or p.status in ('verified', 'refunded') then 'needs_review'
        when p.status in ('failed', 'abandoned') then p.status::text
        when o.status in ('failed', 'abandoned', 'expired') then o.status::text
        else 'pending'
      end as display_status
    from public.orders o
    join public.events e on e.id = o.event_id
    left join lateral (
      select pay.provider, pay.provider_reference, pay.status,
        pay.raw_verification, pay.verified_at
      from public.payments pay
      where pay.order_id = o.id
      order by (pay.status in ('verified', 'refunded')) desc,
        coalesce(pay.verified_at, pay.updated_at, pay.created_at) desc, pay.id desc
      limit 1
    ) p on true
  ),
  filtered as (
    select * from transactions t
    where (coalesce(btrim(p_search), '') = '' or position(
      lower(btrim(p_search)) in lower(concat_ws(' ', t.reference,
        t.customer_name, t.customer_email, t.event_title, t.provider_reference))
    ) > 0)
      and (p_status = 'all' or t.display_status = p_status)
      and (p_method = 'all' or t.provider = p_method)
  ),
  page as (
    select * from filtered
    order by created_at desc, id desc
    limit 25 offset (p_page - 1) * 25
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', p_page,
    'pageSize', 25,
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'reference', reference, 'createdAt', created_at,
        'customerName', customer_name, 'customerEmail', customer_email,
        'eventTitle', event_title, 'amountKobo', total_kobo, 'currency', currency,
        'paymentMethod', payment_method, 'provider', provider,
        'providerReference', provider_reference, 'status', display_status,
        'orderStatus', order_status, 'paymentStatus', coalesce(payment_status, 'not_started'),
        'verifiedAt', verified_at
      ) order by created_at desc, id desc) from page
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_transactions(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_transactions(text, text, text, integer) to service_role;
