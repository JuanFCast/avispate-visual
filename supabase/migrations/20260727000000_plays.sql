-- ============================================================================
-- Avíspate · Recibo de jugada: lo que se cobró, aunque la partida no termine
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Por qué existe:
--   `scores` solo se escribe cuando la partida TERMINA y el resultado llega al
--   servidor. Hasta ahora, si ese envío final fallaba (nodo de Celo atrasado,
--   internet caído, base de datos con hipo), el jugador había pagado sus 0.10
--   USDT o gastado su jugada gratis del día y en el servidor no quedaba ni
--   rastro: ni ranking, ni forma de saber a quién compensar.
--
--   `plays` se escribe apenas la transacción `play(deck)` se confirma, ANTES
--   de repartir cartas. Es el recibo: esta wallet pagó esta ronda y este mazo.
--   El resultado sigue viviendo en `scores`, que es lo que lee el ranking.
--
-- Jugadas cobradas que nunca dieron resultado (para compensar o reponer):
--   select p.* from public.plays p
--   left join public.scores s on s.tx_hash = p.tx_hash
--   where s.id is null and p.round_date = (now() at time zone 'utc')::date;
-- ============================================================================

create table if not exists public.plays (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- Misma llave que `scores.tx_hash`: une el recibo con su resultado y hace
  -- que registrar dos veces la misma jugada no cree dos filas.
  tx_hash     text not null unique,
  deck_size   smallint not null check (deck_size in (10, 15, 20)),
  round_date  date not null default (now() at time zone 'utc')::date,
  -- Del evento del contrato: false = consumió la gratis del día.
  is_paid     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Cruce "jugadas de la ronda" contra el ranking del día.
create index if not exists plays_round_idx
  on public.plays (round_date, deck_size);

-- Jugadas de un perfil en una ronda (soporte, compensaciones).
create index if not exists plays_profile_idx
  on public.plays (profile_id, round_date);

alter table public.plays enable row level security;

-- Sin política de lectura: a diferencia del ranking, el recibo de una jugada
-- no es información pública. Solo el backend (service_role) lo ve.
grant all on public.plays to service_role;
