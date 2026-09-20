-- A single aggregate payload avoids the API's row cap on large catalogues.
-- Only the server role may execute this function; the HTTP route checks the
-- separate administrator session before calling it.
create function public.admin_sales_analytics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with event_catalogue as (
    select e.id, e.title, e.status, coalesce(c.name, 'Other') as category,
      coalesce(org.name, 'Independent organiser') as organiser
    from public.events e
    left join public.categories c on c.id = e.category_id
    left join public.organisers org on org.id = e.organiser_id
  ),
  verified_orders as (
    select o.id, o.event_id, o.fee_kobo,
      greatest(0, o.subtotal_kobo - o.discount_kobo - coalesce((
        select sum(coalesce(r.amount_kobo, o.subtotal_kobo - o.discount_kobo))
        from public.refunds r
        where r.order_id = o.id and r.status = 'completed'
      ), 0)) as ticket_revenue_kobo
    from public.orders o
    where o.status in ('paid', 'partially_refunded')
      and exists (
        select 1 from public.payments p
        where p.order_id = o.id and p.status = 'verified'
      )
  ),
  order_sales as (
    select event_id, count(*)::bigint as bookings,
      sum(ticket_revenue_kobo)::bigint as revenue,
      sum(fee_kobo)::bigint as service_fees
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
    where r.released_at is null and r.converted_at is null and r.expires_at > now()
    group by r.ticket_type_id
  ),
  inventory as (
    select tt.event_id,
      sum(case when tt.active then greatest(0, tt.quantity_total - tt.quantity_sold - coalesce(live_holds.quantity, 0)) else 0 end)::bigint as remaining,
      sum(coalesce(live_holds.quantity, 0))::bigint as reserved
    from public.ticket_types tt
    left join live_holds on live_holds.ticket_type_id = tt.id
    group by tt.event_id
  ),
  per_event as (
    select e.id, e.title, e.category, e.organiser, e.status,
      coalesce(order_sales.bookings, 0) as bookings,
      coalesce(issued_sales.tickets, 0) as tickets,
      coalesce(order_sales.revenue, 0) as revenue,
      coalesce(order_sales.service_fees, 0) as service_fees,
      coalesce(inventory.remaining, 0) as remaining,
      coalesce(inventory.reserved, 0) as reserved
    from event_catalogue e
    left join order_sales on order_sales.event_id = e.id
    left join issued_sales on issued_sales.event_id = e.id
    left join inventory on inventory.event_id = e.id
  ),
  category_sales as (
    select category, sum(tickets)::bigint as tickets, sum(revenue)::bigint as revenue
    from per_event group by category
  ),
  top_events as (
    select * from per_event
    where bookings > 0
    order by revenue desc, tickets desc, id
    limit 10
  )
  select jsonb_build_object(
    'eventCount', (select count(*) from per_event),
    'bookings', (select coalesce(sum(bookings), 0) from per_event),
    'ticketsSold', (select coalesce(sum(tickets), 0) from per_event),
    'ticketRevenueKobo', (select coalesce(sum(revenue), 0) from per_event),
    'serviceFeesKobo', (select coalesce(sum(service_fees), 0) from per_event),
    'inventoryRemaining', (select coalesce(sum(remaining), 0) from per_event),
    'inventoryReserved', (select coalesce(sum(reserved), 0) from per_event),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'ticketsSold', tickets, 'revenueKobo', revenue) order by revenue desc, category)
      from category_sales where tickets > 0 or revenue > 0
    ), '[]'::jsonb),
    'topEvents', coalesce((
      select jsonb_agg(jsonb_build_object('eventId', id, 'title', title, 'organiser', organiser, 'category', category, 'status', status, 'bookings', bookings, 'ticketsSold', tickets, 'revenueKobo', revenue, 'inventoryRemaining', remaining) order by revenue desc, tickets desc, id)
      from top_events
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_sales_analytics() from public, anon, authenticated;
grant execute on function public.admin_sales_analytics() to service_role;
