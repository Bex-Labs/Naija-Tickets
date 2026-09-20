-- NIN/CAC submissions stay in the private verification table. Track whether
-- the organiser has seen the latest administrator decision.
alter table public.organiser_verification_requests
  add column decision_seen_at timestamptz;

create function public.validate_organiser_identity_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organiser_type text;
begin
  select account_type into organiser_type from public.organisers
  where id = new.organiser_id;
  if organiser_type = 'individual' and new.registration_reference !~ '^[0-9]{11}$' then
    raise exception 'NIN must contain exactly 11 digits' using errcode = '22023';
  end if;
  if organiser_type = 'organisation' and new.registration_reference !~ '^[A-Za-z0-9][A-Za-z0-9 /-]{2,39}$' then
    raise exception 'Enter a valid CAC registration number' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger validate_organiser_identity_before_save
before insert or update of registration_reference on public.organiser_verification_requests
for each row execute function public.validate_organiser_identity_reference();

create function public.mark_organiser_verification_decision_unread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('verified', 'rejected') and old.status is distinct from new.status then
    new.decision_seen_at := null;
  end if;
  return new;
end;
$$;

create trigger mark_verification_decision_unread
before update of status on public.organiser_verification_requests
for each row execute function public.mark_organiser_verification_decision_unread();

revoke all on function public.validate_organiser_identity_reference() from public, anon, authenticated;
revoke all on function public.mark_organiser_verification_decision_unread() from public, anon, authenticated;
