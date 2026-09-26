-- Hide events at their actual finish time without deleting event or sales history.
alter policy events_public_read on public.events using (
  (status = 'published' and ends_at > now())
  or public.is_organiser_member(organiser_id)
  or public.has_role('administrator')
);

alter policy saved_events_owner_insert on public.saved_events with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.events
    where id = saved_events.event_id and status = 'published' and ends_at > now()
  )
);

-- All checkout paths insert an order. Reject new purchases even when a stale
-- browser or privileged checkout RPC bypasses the public catalogue policies.
-- Existing orders may still settle, be refunded, or be reviewed after the event.
create function public.require_available_event_for_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.events
    where id = new.event_id and status = 'published' and ends_at > now()
  ) then
    raise exception 'This event is not available for checkout.';
  end if;
  return new;
end;
$$;

revoke all on function public.require_available_event_for_order() from public, anon, authenticated;
create trigger orders_require_available_event
before insert on public.orders
for each row execute function public.require_available_event_for_order();

create index events_public_end_idx on public.events (ends_at)
where status = 'published';
