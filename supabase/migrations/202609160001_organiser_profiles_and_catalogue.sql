-- Distinguish individual and organisation organisers, add public social links,
-- and expand the event category catalogue.

alter table public.organisers
  add column if not exists account_type text not null default 'organisation',
  add column if not exists website_url text,
  add column if not exists instagram_url text,
  add column if not exists x_url text,
  add column if not exists facebook_url text,
  add column if not exists tiktok_url text;

alter table public.organisers
  drop constraint if exists organisers_account_type_check;

alter table public.organisers
  add constraint organisers_account_type_check
  check (account_type in ('individual', 'organisation'));

update public.organisers as organiser
set account_type = 'individual'
where exists (
  select 1
  from public.organiser_memberships as membership
  join auth.users as account on account.id = membership.user_id
  where membership.organiser_id = organiser.id
    and account.raw_user_meta_data ->> 'account_type' = 'individual'
);

insert into public.categories (name, slug, sort_order) values
  ('Concert', 'concert', 1),
  ('Conference', 'conference', 2),
  ('Festival', 'festival', 3),
  ('Trade show', 'trade-show', 4),
  ('Workshop', 'workshop', 5),
  ('Sports', 'sports', 6),
  ('Spirituality & religion', 'spirituality-religion', 7),
  ('Community', 'community', 8),
  ('Food & drinks', 'food-drinks', 9),
  ('Book clubs', 'book-clubs', 10),
  ('Arts & culture', 'arts-culture', 11),
  ('Business', 'business', 12),
  ('Technology', 'technology', 13),
  ('Health & wellness', 'health-wellness', 14),
  ('Fashion', 'fashion', 15),
  ('Comedy', 'comedy', 16),
  ('Film', 'film', 17),
  ('Nightlife', 'nightlife', 18)
on conflict (slug) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  active = true;

comment on column public.organisers.account_type
is 'Whether the organiser operates in an individual name or as an organisation.';

comment on column public.organisers.website_url
is 'Optional public organiser website URL.';

