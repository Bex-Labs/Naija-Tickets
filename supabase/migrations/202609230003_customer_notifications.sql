create table public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  notification_type text not null check (
    notification_type in ('purchase_confirmed', 'event_available', 'event_unavailable', 'event_updated')
  ),
  title text not null check (char_length(trim(title)) between 2 and 160),
  message text not null check (char_length(trim(message)) between 2 and 500),
  link_path text check (link_path is null or link_path ~ '^/'),
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index customer_notifications_user_created_idx
  on public.customer_notifications (user_id, created_at desc);

alter table public.customer_notifications enable row level security;
revoke all on table public.customer_notifications from public, anon;
grant select, update on table public.customer_notifications to authenticated;
grant select, insert, update on table public.customer_notifications to service_role;

create policy customer_notifications_owner_read on public.customer_notifications
for select using (user_id = auth.uid());

create policy customer_notifications_owner_update on public.customer_notifications
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create function public.notify_customer_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_title text;
begin
  if new.customer_id is not null
    and new.status = 'paid'
    and (tg_op = 'INSERT' or old.status <> 'paid') then
    select title into event_title from public.events where id = new.event_id;
    insert into public.customer_notifications (
      user_id, event_id, order_id, notification_type, title, message,
      link_path, dedupe_key
    ) values (
      new.customer_id,
      new.event_id,
      new.id,
      'purchase_confirmed',
      'Tickets confirmed',
      'Your tickets for ' || coalesce(event_title, 'your event') || ' are ready.',
      '/payment/status?reference=' || new.reference,
      'purchase-confirmed:' || new.id::text
    ) on conflict (user_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger notify_customer_purchase_after_write
after insert or update of status on public.orders
for each row execute function public.notify_customer_purchase();

create function public.notify_customers_of_event_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notice_type text;
  notice_title text;
  notice_message text;
  notice_link text;
  notice_key text;
begin
  if old.status = 'published' and new.status <> 'published' then
    notice_type := 'event_unavailable';
    notice_title := case when new.status = 'cancelled' then 'Event cancelled' else 'Event currently unavailable' end;
    notice_message := new.title || case
      when new.status = 'cancelled' then ' has been cancelled.'
      else ' is temporarily unavailable. Check your account for updates.'
    end;
    notice_link := null;
    notice_key := 'event-unavailable:' || new.id::text || ':' || new.version::text || ':' || new.status::text;
  elsif new.status = 'published' and old.status <> 'published' then
    notice_type := 'event_available';
    notice_title := 'Event available again';
    notice_message := new.title || ' is available. Review the latest event details.';
    notice_link := '/events/' || new.slug;
    notice_key := 'event-available:' || new.id::text || ':' || new.version::text;
  elsif new.status = 'published' and old.status = 'published' and (
    old.starts_at is distinct from new.starts_at
    or old.ends_at is distinct from new.ends_at
    or old.venue_name is distinct from new.venue_name
    or old.address is distinct from new.address
  ) then
    notice_type := 'event_updated';
    notice_title := 'Event details updated';
    notice_message := 'The date, time or venue for ' || new.title || ' has changed.';
    notice_link := '/events/' || new.slug;
    notice_key := 'event-updated:' || new.id::text || ':' || extract(epoch from new.updated_at)::bigint::text;
  else
    return new;
  end if;

  insert into public.customer_notifications (
    user_id, event_id, notification_type, title, message, link_path, dedupe_key
  )
  select recipient.user_id, new.id, notice_type, notice_title, notice_message,
    notice_link, notice_key
  from (
    select saved.user_id from public.saved_events as saved where saved.event_id = new.id
    union
    select checkout_order.customer_id from public.orders as checkout_order
    where checkout_order.event_id = new.id
      and checkout_order.customer_id is not null
      and checkout_order.status in ('paid', 'refunded', 'partially_refunded')
  ) as recipient
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end;
$$;

create trigger notify_customers_of_event_change_after_update
after update of status, starts_at, ends_at, venue_name, address on public.events
for each row execute function public.notify_customers_of_event_change();

insert into public.customer_notifications (
  user_id, event_id, order_id, notification_type, title, message,
  link_path, dedupe_key, created_at
)
select
  checkout_order.customer_id,
  checkout_order.event_id,
  checkout_order.id,
  'purchase_confirmed',
  'Tickets confirmed',
  'Your tickets for ' || event.title || ' are ready.',
  '/payment/status?reference=' || checkout_order.reference,
  'purchase-confirmed:' || checkout_order.id::text,
  coalesce(checkout_order.paid_at, checkout_order.updated_at, checkout_order.created_at)
from public.orders as checkout_order
join public.events as event on event.id = checkout_order.event_id
where checkout_order.status = 'paid'
  and checkout_order.customer_id is not null
on conflict (user_id, dedupe_key) do nothing;

revoke all on function public.notify_customer_purchase() from public, anon, authenticated;
revoke all on function public.notify_customers_of_event_change() from public, anon, authenticated;
