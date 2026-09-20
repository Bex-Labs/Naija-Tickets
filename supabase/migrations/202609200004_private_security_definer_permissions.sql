-- Supabase can grant EXECUTE directly to anon/authenticated by default.
-- Keep policy helper functions callable by RLS; all other security-definer
-- functions in public are server or trigger entry points in this app.
do $$
declare
  target record;
begin
  for target in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('has_role', 'is_organiser_member')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', target.signature);
  end loop;
end;
$$;
