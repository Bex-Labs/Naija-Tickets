-- Naija Tickets initial schema. Money is stored as integer kobo.
create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'organiser', 'check_in_staff', 'administrator');
create type public.application_status as enum ('pending', 'approved', 'rejected');
create type public.event_status as enum ('draft', 'submitted', 'published', 'rejected', 'cancelled', 'completed');
create type public.order_status as enum ('pending', 'paid', 'failed', 'abandoned', 'expired', 'refunded', 'partially_refunded');
create type public.payment_status as enum ('initialized', 'pending', 'verified', 'failed', 'abandoned', 'refunded');
create type public.refund_status as enum ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');
create type public.payout_status as enum ('pending', 'approved', 'processing', 'paid', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.organiser_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id),
  business_name text not null,
  contact_email text not null,
  phone text not null,
  registration_number text,
  description text not null,
  status public.application_status not null default 'pending',
  review_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organisers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid unique references public.organiser_applications(id),
  name text not null,
  slug text not null unique,
  contact_email text not null,
  phone text,
  description text,
  logo_path text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organiser_memberships (
  organiser_id uuid not null references public.organisers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  primary key (organiser_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.organisers(id),
  category_id uuid not null references public.categories(id),
  title text not null,
  slug text not null unique,
  description text not null,
  venue_name text not null,
  address text not null,
  city text not null,
  state text not null,
  timezone text not null default 'Africa/Lagos',
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  status public.event_status not null default 'draft',
  featured boolean not null default false,
  image_path text,
  schedule jsonb not null default '[]'::jsonb,
  policies jsonb not null default '[]'::jsonb,
  rejection_reason text,
  published_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  description text,
  price_kobo bigint not null check (price_kobo >= 0),
  quantity_total integer not null check (quantity_total >= 0),
  quantity_sold integer not null default 0 check (quantity_sold >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  min_per_order integer not null default 1 check (min_per_order > 0),
  max_per_order integer not null default 6 check (max_per_order >= min_per_order),
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  inclusions jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (event_id, name),
  check (quantity_sold + quantity_reserved <= quantity_total)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  customer_id uuid not null references public.profiles(id),
  event_id uuid not null references public.events(id),
  status public.order_status not null default 'pending',
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  subtotal_kobo bigint not null default 0 check (subtotal_kobo >= 0),
  fee_kobo bigint not null default 0 check (fee_kobo >= 0),
  total_kobo bigint not null default 0 check (total_kobo = subtotal_kobo + fee_kobo),
  reservation_expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id),
  quantity integer not null check (quantity > 0),
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  line_total_kobo bigint not null check (line_total_kobo = unit_price_kobo * quantity),
  attendee_data jsonb not null default '[]'::jsonb
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references public.order_items(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id),
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  released_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(released_at, converted_at) <= 1)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null default 'paystack' check (provider in ('paystack', 'demo_free')),
  provider_reference text not null,
  status public.payment_status not null default 'initialized',
  amount_kobo bigint not null check (amount_kobo >= 0),
  raw_verification jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload_hash text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id),
  event_id uuid not null references public.events(id),
  attendee_name text not null,
  attendee_email text not null,
  qr_token_hash text not null unique,
  display_code text not null unique,
  status text not null default 'valid' check (status in ('valid', 'used', 'cancelled', 'refunded')),
  issued_at timestamptz not null default now()
);

create table public.event_staff_assignments (
  event_id uuid not null references public.events(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (event_id, staff_id)
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.tickets(id),
  event_id uuid not null references public.events(id),
  staff_id uuid not null references public.profiles(id),
  checked_in_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  requested_by uuid not null references public.profiles(id),
  reason text not null,
  amount_kobo bigint check (amount_kobo >= 0),
  status public.refund_status not null default 'requested',
  provider_reference text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  provider_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'completed' or provider_confirmed_at is not null)
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.organisers(id),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  gross_kobo bigint not null check (gross_kobo >= 0),
  fees_kobo bigint not null check (fees_kobo >= 0),
  refunds_kobo bigint not null check (refunds_kobo >= 0),
  net_kobo bigint not null,
  status public.payout_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_public_catalogue_idx on public.events (status, starts_at) where status = 'published';
create index events_location_idx on public.events (state, city, starts_at);
create index events_organiser_idx on public.events (organiser_id, status);
create index ticket_types_event_idx on public.ticket_types (event_id, active, sort_order);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_event_idx on public.orders (event_id, status);
create index reservations_expiry_idx on public.reservations (expires_at) where released_at is null and converted_at is null;
create index tickets_event_idx on public.tickets (event_id, status);
create index audit_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create or replace function public.has_role(required_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = required_role)
$$;

create or replace function public.is_organiser_member(target_organiser uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organiser_memberships where organiser_id = target_organiser and user_id = auth.uid())
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.organiser_applications enable row level security;
alter table public.organisers enable row level security;
alter table public.organiser_memberships enable row level security;
alter table public.categories enable row level security;
alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reservations enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.tickets enable row level security;
alter table public.event_staff_assignments enable row level security;
alter table public.check_ins enable row level security;
alter table public.refunds enable row level security;
alter table public.payouts enable row level security;
alter table public.platform_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.has_role('administrator'));
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy roles_self_read on public.user_roles for select using (user_id = auth.uid() or public.has_role('administrator'));
create policy roles_admin_write on public.user_roles for all using (public.has_role('administrator')) with check (public.has_role('administrator'));
create policy applications_owner_read on public.organiser_applications for select using (applicant_id = auth.uid() or public.has_role('administrator'));
create policy applications_owner_insert on public.organiser_applications for insert with check (applicant_id = auth.uid() and status = 'pending');
create policy applications_admin_update on public.organiser_applications for update using (public.has_role('administrator'));
create policy organisers_public_read on public.organisers for select using (approved_at is not null);
create policy organiser_members_read on public.organiser_memberships for select using (user_id = auth.uid() or public.has_role('administrator'));
create policy categories_public_read on public.categories for select using (active or public.has_role('administrator'));
create policy categories_admin_write on public.categories for all using (public.has_role('administrator')) with check (public.has_role('administrator'));
create policy events_public_read on public.events for select using (status = 'published' or public.is_organiser_member(organiser_id) or public.has_role('administrator'));
create policy events_member_insert on public.events for insert with check (public.is_organiser_member(organiser_id));
create policy events_member_update on public.events for update using (public.is_organiser_member(organiser_id) or public.has_role('administrator')) with check (public.is_organiser_member(organiser_id) or public.has_role('administrator'));
create policy ticket_types_visible on public.ticket_types for select using (exists (select 1 from public.events e where e.id = event_id and (e.status = 'published' or public.is_organiser_member(e.organiser_id) or public.has_role('administrator'))));
create policy customer_orders_read on public.orders for select using (customer_id = auth.uid() or public.has_role('administrator') or exists (select 1 from public.events e where e.id = event_id and public.is_organiser_member(e.organiser_id)));
create policy customer_order_items_read on public.order_items for select using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.has_role('administrator'))));
create policy customer_tickets_read on public.tickets for select using (exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id where oi.id = order_item_id and o.customer_id = auth.uid()) or public.has_role('administrator'));
create policy assigned_staff_tickets_read on public.tickets for select using (exists (select 1 from public.event_staff_assignments a where a.event_id = tickets.event_id and a.staff_id = auth.uid()));
create policy refunds_owner_read on public.refunds for select using (requested_by = auth.uid() or public.has_role('administrator'));
create policy refunds_owner_insert on public.refunds for insert with check (requested_by = auth.uid() and status = 'requested');
create policy payouts_organiser_read on public.payouts for select using (public.is_organiser_member(organiser_id) or public.has_role('administrator'));
create policy settings_public_read on public.platform_settings for select using (key in ('platform_fee') or public.has_role('administrator'));
create policy audit_admin_read on public.audit_logs for select using (public.has_role('administrator'));

-- Payments, reservations, ticket issuance, check-ins, refunds, payouts and audit writes
-- intentionally have no client write policy. Trusted server functions use the service role.
