-- Private organiser analytics. Aggregation runs in PostgreSQL so large events are
-- complete and no customer or attendee details reach the browser.
create function public.organiser_sales_analytics(p_user_id uuid)
returns table (
  event_id uuid,
  event_title text,
  category_name text,
  event_status public.event_status,
  starts_at timestamptz,
  tickets_sold bigint,
  revenue_kobo bigint,
  inventory_remaining bigint,
  inventory_reserved bigint,
  inventory_total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with owned_events as (
    select e.id, e.title, e.status, e.starts_at, coalesce(c.name, 'Other') as category
    from public.events e
    join public.organiser_memberships m on m.organiser_id = e.organiser_id
    left join public.categories c on c.id = e.category_id
    where m.user_id = p_user_id
  ),
  verified_orders as (
    select o.id, o.event_id,
      greatest(0, o.subtotal_kobo - o.discount_kobo - coalesce((
        select sum(coalesce(r.amount_kobo, o.subtotal_kobo - o.discount_kobo))
        from public.refunds r
        where r.order_id = o.id and r.status = 'completed'
      ), 0)) as ticket_revenue_kobo
    from public.orders o
    join owned_events e on e.id = o.event_id
    where o.status in ('paid', 'partially_refunded')
      and exists (
        select 1 from public.payments p
        where p.order_id = o.id and p.status = 'verified'
      )
  ),
  order_sales as (
    select event_id, sum(ticket_revenue_kobo)::bigint as revenue
    from verified_orders group by event_id
  ),
  issued_sales as (
    select vo.event_id, count(t.id)::bigint as tickets
    from verified_orders vo
    join public.order_items oi on oi.order_id = vo.id
    join public.tickets t on t.order_item_id = oi.id and t.status in ('valid', 'used')
    group by vo.event_id
  ),
  live_holds as (
    select r.ticket_type_id, sum(r.quantity)::bigint as quantity
    from public.reservations r
    join public.ticket_types tt on tt.id = r.ticket_type_id
    join owned_events e on e.id = tt.event_id
    where r.released_at is null and r.converted_at is null and r.expires_at > now()
    group by r.ticket_type_id
  ),
  inventory as (
    select tt.event_id,
      sum(case when tt.active then greatest(0, tt.quantity_total - tt.quantity_sold - coalesce(live_holds.quantity, 0)) else 0 end)::bigint as remaining,
      sum(coalesce(live_holds.quantity, 0))::bigint as reserved,
      sum(tt.quantity_total)::bigint as capacity
    from public.ticket_types tt
    join owned_events e on e.id = tt.event_id
    left join live_holds on live_holds.ticket_type_id = tt.id
    group by tt.event_id
  )
  select e.id, e.title, e.category, e.status, e.starts_at,
    coalesce(issued_sales.tickets, 0), coalesce(order_sales.revenue, 0),
    coalesce(inventory.remaining, 0), coalesce(inventory.reserved, 0),
    coalesce(inventory.capacity, 0)
  from owned_events e
  left join order_sales on order_sales.event_id = e.id
  left join issued_sales on issued_sales.event_id = e.id
  left join inventory on inventory.event_id = e.id
  order by e.starts_at desc, e.id;
$$;

revoke all on function public.organiser_sales_analytics(uuid) from public;
grant execute on function public.organiser_sales_analytics(uuid) to service_role;
