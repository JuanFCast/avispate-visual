-- ============================================================================
-- Avíspate · Semilla del reto diario en `plays`
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- `/api/plays` ya se llama justo antes de que arranque la partida (el recibo
-- de la jugada cobrada/gratis). Ahora también genera y guarda ahí la semilla
-- del mazo, para que `/api/scores` pueda rejugarlo y comprobar que el puntaje
-- corresponde a una partida real en vez de confiar en lo que mande el cliente.
-- Ver `lib/score-verify.ts`.
--
-- Nula a propósito: las filas de `plays` que ya existían antes de este cambio
-- no tienen semilla, así que una jugada que estuviera exactamente a mitad de
-- camino en el momento del despliegue no podrá enviar su puntaje después —
-- su pago ya quedó registrado igual, así que no se pierde dinero, solo esa
-- marca puntual. Es el mismo costo de transición que ya se aceptó en otros
-- cambios de este tipo en el proyecto.
-- ============================================================================

alter table public.plays
  add column if not exists seed text;
