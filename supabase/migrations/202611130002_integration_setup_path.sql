-- Save the developer/no-code choice with the connection, not only React state.
alter table public.integrations add column setup_path text not null default 'link'
 check(setup_path in ('link','api'));
update public.integrations a set setup_path='api' where exists(
 select 1 from public.integration_api_keys k where k.integration_id=a.id and revoked_at is null and expires_at>now()
);
alter function public.integration_public_metadata(uuid) rename to integration_public_metadata_pre_path;
create function public.integration_public_metadata(p_integration_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.integration_public_metadata_pre_path(a.id)||jsonb_build_object('setupPath',a.setup_path)
 from public.integrations a where id=p_integration_id;
$$;
create function public.save_integration_setup_v2(p_user_id uuid,p_integration_id uuid,p_organiser_id uuid,
 p_name text,p_status text,p_domains jsonb,p_event_ids uuid[],p_setup_mode text,p_website_location text,p_setup_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
 if p_setup_path is null or p_setup_path not in ('link','api')
 then raise exception 'Choose a checkout link or developer API.' using errcode='NT400'; end if;
 saved:=public.save_integration_setup(p_user_id,p_integration_id,p_organiser_id,p_name,p_status,p_domains,p_event_ids,p_setup_mode,p_website_location);
 update public.integrations set setup_path=p_setup_path where id=(saved->>'id')::uuid;
 return public.integration_public_metadata((saved->>'id')::uuid);
end; $$;
revoke all on function public.integration_public_metadata(uuid),public.integration_public_metadata_pre_path(uuid),
 public.save_integration_setup_v2(uuid,uuid,uuid,text,text,jsonb,uuid[],text,text,text) from public,anon,authenticated;
grant execute on function public.integration_public_metadata(uuid),public.integration_public_metadata_pre_path(uuid),
 public.save_integration_setup_v2(uuid,uuid,uuid,text,text,jsonb,uuid[],text,text,text) to service_role;
notify pgrst,'reload schema';
