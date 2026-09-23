create table public.saved_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index saved_events_user_created_idx
  on public.saved_events (user_id, created_at desc);

alter table public.saved_events enable row level security;
revoke all on table public.saved_events from public, anon;
grant select, insert, delete on table public.saved_events to authenticated;
grant select, insert, delete on table public.saved_events to service_role;

create policy saved_events_owner_read on public.saved_events
for select using (user_id = auth.uid());

create policy saved_events_owner_insert on public.saved_events
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.events
    where id = saved_events.event_id and status = 'published'
  )
);

create policy saved_events_owner_delete on public.saved_events
for delete using (user_id = auth.uid());
