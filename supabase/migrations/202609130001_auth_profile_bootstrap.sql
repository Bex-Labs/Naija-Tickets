-- Create the application-side profile and default role for every Auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_name text;
begin
  display_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');

  if display_name is null or char_length(display_name) not between 2 and 120 then
    display_name := 'Naija Tickets Guest';
  end if;

  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    display_name,
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();
