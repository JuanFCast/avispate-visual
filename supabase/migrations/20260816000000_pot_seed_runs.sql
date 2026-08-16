-- ============================================================================
-- Avíspate · Cerrojo y contador del sembrador de pozos
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Una fila por mazo. Hace dos trabajos:
--
--   1. CERROJO. `/api/cron/seed-pots` corre desde tres sitios distintos (pg_cron
--      de Supabase, cron de Vercel y GitHub Actions) y dos de ellos pueden
--      solaparse. Sin cerrojo las dos corridas leen el mismo pozo en 0,00, las
--      dos calculan un aporte de 0,30 y el pozo acaba en 0,60: la casa paga
--      doble. La toma es un UPDATE condicional (`locked_until < now()`), que en
--      Postgres es atómico: solo una de las dos corridas se lleva la fila.
--
--   2. TOPE POR RONDA. `spent_units` cuenta lo que la casa ya puso en ese mazo
--      durante `round_date`. El robot no pasa de dos suelos por ronda, así que
--      un bucle no puede vaciar el Funder. Al cambiar de ronda se reinicia solo.
--
-- Por qué el cerrojo es un ARRIENDO y no una marca de "ya hecho": una marca por
-- (ronda, mazo) haría que una siembra fallida dejara el mazo intocable el resto
-- del día — exactamente el estado absorbente que este trabajo viene a arreglar.
-- El arriendo vence, así que la corrida siguiente siempre puede reintentar.
-- ============================================================================

create table if not exists public.pot_seed_runs (
  deck_size    smallint    primary key,
  -- Ronda a la que corresponde `spent_units` (UTC, igual que round_settlements).
  round_date   date        not null default (now() at time zone 'utc')::date,
  -- Unidades de USDT (6 decimales) que la casa puso en este mazo esa ronda.
  spent_units  bigint      not null default 0,
  -- Hasta cuándo está tomada la fila. En el pasado = libre.
  locked_until timestamptz not null default now(),
  last_tx_hash text,
  last_error   text,
  last_run_at  timestamptz,
  updated_at   timestamptz not null default now()
);

-- Los tres mazos existen siempre: así la toma del cerrojo es un UPDATE puro y
-- no hay que resolver una carrera de inserción además de la del arriendo.
insert into public.pot_seed_runs (deck_size)
values (10), (15), (20)
on conflict (deck_size) do nothing;

-- Solo el service role (todo pasa por la API del servidor).
alter table public.pot_seed_runs enable row level security;
grant all on public.pot_seed_runs to service_role;
