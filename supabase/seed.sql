-- Reference records required by a fresh local environment.
-- Public events must be created by real organisers and approved by an admin.

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

insert into public.platform_settings (key, value)
values ('platform_fee', '{"type":"percentage","basis_points":500}')
on conflict (key) do nothing;
