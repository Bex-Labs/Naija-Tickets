-- Supabase may explicitly grant execute to API roles through default privileges.
-- Revoking PUBLIC alone is insufficient for security-definer functions with
-- caller-supplied user IDs; permit only the server's service role.
revoke all on function public.organiser_sales_analytics(uuid) from public, anon, authenticated;
revoke all on function public.create_organiser_promo_code(uuid, uuid, text, text, bigint, timestamptz, timestamptz, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.create_checkout_reservation_v3(uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.organiser_sales_analytics(uuid) to service_role;
grant execute on function public.create_organiser_promo_code(uuid, uuid, text, text, bigint, timestamptz, timestamptz, integer, uuid[]) to service_role;
grant execute on function public.create_checkout_reservation_v3(uuid, uuid, jsonb, jsonb, text, text) to service_role;
