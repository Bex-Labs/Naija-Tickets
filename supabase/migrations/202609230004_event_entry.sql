-- Every currently issued QR ticket permits one admission. The existing unique
-- check_ins.ticket_id constraint remains the final protection against re-entry.
create function public.verify_event_entry(
  p_staff_id uuid, p_event_id uuid, p_code text, p_admit boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events%rowtype;
  ticket_row public.tickets%rowtype;
  order_row public.orders%rowtype;
  matched_id uuid;
  matched_order uuid;
  tier_name text;
  checked_at timestamptz;
  outcome text;
begin
  -- Authorise before searching for a ticket or exposing attendee information.
  if not exists (select 1 from public.event_staff_assignments
      where event_id = p_event_id and staff_id = p_staff_id)
    and not exists (select 1 from public.events e
      join public.organiser_memberships m on m.organiser_id = e.organiser_id
      where e.id = p_event_id and m.user_id = p_staff_id) then
    raise exception 'You are not assigned to this event.' using errcode = '42501';
  end if;

  select * into event_row from public.events where id = p_event_id for share;
  if event_row.status <> 'published' then
    return jsonb_build_object('outcome', 'event_unavailable', 'admitted', false);
  end if;
  if p_code is null or upper(trim(p_code)) !~ '^NT-[A-F0-9]{12}$' then
    return jsonb_build_object('outcome', 'invalid', 'admitted', false);
  end if;
  select t.id, i.order_id, tt.name into matched_id, matched_order, tier_name
    from public.tickets t
    join public.order_items i on i.id = t.order_item_id
    join public.ticket_types tt on tt.id = i.ticket_type_id
    where t.event_id = p_event_id and t.display_code = upper(trim(p_code));
  if matched_id is null then
    return jsonb_build_object('outcome', 'invalid', 'admitted', false);
  end if;

  -- Coordinate with payment/refund writes, then serialise concurrent scans of
  -- the same ticket. All decisions are made again while holding these locks.
  select * into order_row from public.orders where id = matched_order for share;
  select * into ticket_row from public.tickets where id = matched_id for update;
  select checked_in_at into checked_at from public.check_ins where ticket_id = matched_id;

  if ticket_row.status in ('cancelled', 'refunded') then
    outcome := ticket_row.status;
  elsif order_row.status not in ('paid', 'partially_refunded') or not exists (
    select 1 from public.payments where order_id = matched_order and status = 'verified'
  ) then
    outcome := 'unpaid';
  elsif checked_at is not null or ticket_row.status = 'used' then
    outcome := 'already_used';
  elsif ticket_row.status <> 'valid' then
    outcome := 'invalid';
  elsif p_admit then
    checked_at := clock_timestamp();
    insert into public.check_ins(ticket_id,event_id,staff_id,checked_in_at)
      values (matched_id,p_event_id,p_staff_id,checked_at);
    update public.tickets set status = 'used' where id = matched_id;
    outcome := 'admitted';
  else
    outcome := 'valid';
  end if;
  return jsonb_build_object(
    'outcome', outcome, 'admitted', outcome = 'admitted',
    'attendeeName', ticket_row.attendee_name, 'ticketType', tier_name,
    'displayCode', ticket_row.display_code, 'eventTitle', event_row.title,
    'admissionLimit', 1,
    'admissionsUsed', case when checked_at is not null or ticket_row.status = 'used' then 1 else 0 end,
    'checkedInAt', checked_at
  );
end;
$$;

create function public.assign_event_entry_staff(
  p_actor_id uuid, p_event_id uuid, p_email text
)
returns void language plpgsql security definer set search_path = '' as $$
declare target_staff uuid;
begin
  if not exists (select 1 from public.events e
    join public.organiser_memberships m on m.organiser_id = e.organiser_id
    where e.id = p_event_id and m.user_id = p_actor_id) then
    raise exception 'Organiser access required.' using errcode = '42501';
  end if;
  select id into target_staff from auth.users
    where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if target_staff is null then
    raise exception 'Ask this staff member to create and confirm an account first.' using errcode = '22023';
  end if;
  insert into public.event_staff_assignments(event_id,staff_id,assigned_by)
    values(p_event_id,target_staff,p_actor_id)
    on conflict (event_id,staff_id) do nothing;
end;
$$;

revoke all on function public.verify_event_entry(uuid,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.assign_event_entry_staff(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.verify_event_entry(uuid,uuid,text,boolean) to service_role;
grant execute on function public.assign_event_entry_staff(uuid,uuid,text) to service_role;
