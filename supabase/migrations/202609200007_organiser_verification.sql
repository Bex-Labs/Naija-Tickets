-- Only the public verified timestamp is stored on the public organiser row.
alter table public.organisers add column verified_at timestamptz;

create table public.organiser_verification_requests (
  organiser_id uuid primary key references public.organisers(id) on delete cascade,
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 120),
  registration_reference text not null check (char_length(trim(registration_reference)) between 3 and 120),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'unverified')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  updated_at timestamptz not null default now()
);

alter table public.organiser_verification_requests enable row level security;
revoke all on table public.organiser_verification_requests from public, anon, authenticated;
grant select, insert, update on table public.organiser_verification_requests to service_role;

create function public.submit_organiser_verification(
  p_user_id uuid, p_organiser_id uuid, p_legal_name text, p_registration_reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_verified_at timestamptz;
begin
  if not exists (select 1 from public.organiser_memberships
      where user_id = p_user_id and organiser_id = p_organiser_id) then
    raise exception 'Organiser access required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_legal_name, ''))) not between 2 and 120
    or char_length(trim(coalesce(p_registration_reference, ''))) not between 3 and 120 then
    raise exception 'Complete the verification details' using errcode = '22023';
  end if;
  select verified_at into existing_verified_at from public.organisers
    where id = p_organiser_id for update;
  if existing_verified_at is not null then
    raise exception 'Organiser is already verified' using errcode = '22023';
  end if;
  insert into public.organiser_verification_requests
    (organiser_id, legal_name, registration_reference, status, submitted_at, reviewed_at, reviewed_by, review_note, updated_at)
  values (p_organiser_id, trim(p_legal_name), trim(p_registration_reference), 'pending', now(), null, null, null, now())
  on conflict (organiser_id) do update set
    legal_name = excluded.legal_name,
    registration_reference = excluded.registration_reference,
    status = 'pending', submitted_at = now(), reviewed_at = null,
    reviewed_by = null, review_note = null, updated_at = now();
end;
$$;

create function public.review_organiser_verification(
  p_organiser_id uuid, p_approved boolean, p_note text, p_actor text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform 1 from public.organisers where id = p_organiser_id for update;
  select status into current_status from public.organiser_verification_requests
    where organiser_id = p_organiser_id for update;
  if current_status is distinct from 'pending'
     and not (current_status = 'verified' and not p_approved) then
    raise exception 'Verification request cannot be reviewed in its current state' using errcode = '22023';
  end if;
  if not p_approved and char_length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;
  update public.organiser_verification_requests set
    status = case when p_approved then 'verified' else 'rejected' end,
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_by = p_actor, reviewed_at = now(), updated_at = now()
  where organiser_id = p_organiser_id;
  update public.organisers set verified_at = case when p_approved then now() else null end
  where id = p_organiser_id;
end;
$$;

-- A material profile change removes the badge until the organiser reapplies.
create function public.invalidate_organiser_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.verified_at is not null and
     (old.name is distinct from new.name or
      old.contact_email is distinct from new.contact_email or
      old.phone is distinct from new.phone or
      old.account_type is distinct from new.account_type) then
    new.verified_at := null;
    update public.organiser_verification_requests set
      status = 'unverified', review_note = 'Profile details changed; submit verification again.',
      reviewed_at = null, reviewed_by = null, updated_at = now()
    where organiser_id = new.id;
  end if;
  return new;
end;
$$;

create trigger invalidate_organiser_verification_before_update
before update on public.organisers
for each row execute function public.invalidate_organiser_verification();

-- Enforce the publication rule in the database as well as the admin UI.
create function public.require_verified_organiser_for_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published')
    and not exists (select 1 from public.organisers
      where id = new.organiser_id and verified_at is not null) then
    raise exception 'Verify the organiser before publishing this event' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger require_verified_organiser_before_publication
before insert or update of status on public.events
for each row execute function public.require_verified_organiser_for_publication();

revoke all on function public.submit_organiser_verification(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.review_organiser_verification(uuid,boolean,text,text) from public, anon, authenticated;
revoke all on function public.invalidate_organiser_verification() from public, anon, authenticated;
revoke all on function public.require_verified_organiser_for_publication() from public, anon, authenticated;
grant execute on function public.submit_organiser_verification(uuid,uuid,text,text) to service_role;
grant execute on function public.review_organiser_verification(uuid,boolean,text,text) to service_role;
