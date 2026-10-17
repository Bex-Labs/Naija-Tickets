-- The public widget has its own bounded namespaces. Keep the service-only
-- distributed limiter and every prior admin/API/entry namespace intact.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.consume_integration_rate_limit(text,integer,integer)'::regprocedure);
 if position('global:v1|' in definition)=0 then raise exception 'Unexpected limiter definition.'; end if;
 if position('widget:global|' in definition)=0 then
  execute replace(definition,'global:v1|',
   'widget:global|widget:ip:[a-f0-9]{64}|widget:(read|create)(:org)?:[a-f0-9-]{36}|global:v1|');
 end if;
end $$;
