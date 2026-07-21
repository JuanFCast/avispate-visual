-- ============================================================================
-- Avíspate · Fase 2 · Privilegios de tabla para los roles de Supabase
-- ----------------------------------------------------------------------------
-- En proyectos Supabase nuevos, los roles NO reciben privilegios por defecto al
-- crear tablas. service_role se salta RLS pero NO los GRANT de tabla, así que
-- sin esto el backend recibe "42501: permission denied".
-- Ejecutar completo en Supabase → SQL Editor → Run. Idempotente.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- El backend usa service_role (bypassa RLS): acceso total a las tablas.
grant all on public.profiles to service_role;
grant all on public.scores   to service_role;

-- Lectura pública del ranking vía anon/authenticated. La política RLS
-- (profiles_public_read / scores_public_read) ya limita QUÉ se ve; el GRANT es
-- el permiso de tabla que debe acompañarla.
grant select on public.profiles to anon, authenticated;
grant select on public.scores   to anon, authenticated;

-- Que futuras tablas del esquema hereden estos privilegios automáticamente.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant select on tables to anon, authenticated;
