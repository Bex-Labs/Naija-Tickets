-- First-party visitor totals. Only an irreversible hash of a random browser
-- identifier is stored; there is no account, IP address or page history.
create table public.site_visitors (
  visitor_hash text primary key check (visitor_hash ~ '^[a-f0-9]{64}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index site_visitors_last_seen_idx on public.site_visitors(last_seen_at);
alter table public.site_visitors enable row level security;
revoke all on table public.site_visitors from public, anon, authenticated;

create function public.record_site_visitor(p_visitor_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid visitor identifier.';
  end if;

  insert into public.site_visitors(visitor_hash)
  values (p_visitor_hash)
  on conflict (visitor_hash) do update
  set last_seen_at = greatest(public.site_visitors.last_seen_at, excluded.last_seen_at);
end;
$$;

create function public.admin_visitor_analytics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('day', now() at time zone 'Africa/Lagos')
      at time zone 'Africa/Lagos' as today_start
  )
  select jsonb_build_object(
    'totalVisitors', count(*),
    'visitorsToday', count(*) filter (where last_seen_at >= bounds.today_start),
    'visitorsLast30Days', count(*) filter (
      where last_seen_at >= bounds.today_start - interval '29 days'
    ),
    'trackingStartedAt', min(first_seen_at)
  )
  from public.site_visitors cross join bounds;
$$;

revoke all on function public.record_site_visitor(text) from public, anon, authenticated;
revoke all on function public.admin_visitor_analytics() from public, anon, authenticated;
grant execute on function public.record_site_visitor(text) to service_role;
grant execute on function public.admin_visitor_analytics() to service_role;
