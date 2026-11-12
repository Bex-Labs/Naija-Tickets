-- An event may link to its own website without granting that site API access.
alter table public.events
  add column if not exists website_url text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_website_url_format'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events add constraint event_website_url_format check (
      website_url is null or (
        char_length(website_url) <= 2048
        and website_url ~* '^https?://[^[:space:]]+$'
      )
    );
  end if;
end;
$$;

-- Integration managers can use the saved address as a setup suggestion.
-- Event grants and registered origins remain explicit permissions.
create or replace function public.list_organiser_integrations(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with managed as (
    select o.id, o.name from public.organisers o
    where public.integration_manager(p_user_id, o.id)
  )
  select jsonb_build_object(
    'organisers', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id)
      from managed
    ), '[]'::jsonb),
    'integrations', coalesce((
      select jsonb_agg(public.integration_public_metadata(a.id) order by a.created_at desc)
      from public.integrations a
      where a.removed_at is null and a.organiser_id in (select id from managed)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'organiserId', e.organiser_id, 'title', e.title,
        'status', e.status, 'websiteUrl', e.website_url
      ) order by e.title, e.id)
      from public.events e where e.organiser_id in (select id from managed)
    ), '[]'::jsonb)
  );
$$;
