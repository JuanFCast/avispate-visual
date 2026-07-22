-- ============================================================================
-- Avíspate · Fase 3 (pay-to-play) · Rondas diarias + jugadas pagas on-chain
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Cambios:
--   * profiles: la identidad ahora puede ser SOLO por wallet (sin privy_id),
--     para jugadores que pagan con wallet externa sin correo.
--   * scores: cada partida pertenece a una RONDA diaria; las jugadas pagas
--     guardan su tx_hash on-chain (idempotencia + prueba de identidad).
--   * La 1ª jugada GRATIS por mazo y ronda se limita a una por perfil.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PERFILES: permitir identidad solo-wallet
-- ----------------------------------------------------------------------------
alter table public.profiles alter column privy_id drop not null;

alter table public.profiles
  drop constraint if exists profiles_identity_present;
alter table public.profiles
  add constraint profiles_identity_present
  check (privy_id is not null or wallet_address is not null);

-- ----------------------------------------------------------------------------
-- 2. SCORES: ronda diaria + jugada paga
-- ----------------------------------------------------------------------------
alter table public.scores
  add column if not exists round_date date not null
    default (now() at time zone 'utc')::date;
alter table public.scores
  add column if not exists tx_hash text;
alter table public.scores
  add column if not exists is_paid boolean not null default false;

-- tx_hash único: una jugada paga = un puntaje (idempotencia). Nulos permitidos.
create unique index if not exists scores_tx_hash_key
  on public.scores (tx_hash) where tx_hash is not null;

-- Ranking POR RONDA: mazo + día, menor promedio, menos errores como desempate.
create index if not exists scores_round_ranking_idx
  on public.scores (deck_size, round_date, average_ms asc, errors asc);

-- Una sola jugada GRATIS por perfil, mazo y ronda.
create unique index if not exists scores_one_free_per_round
  on public.scores (profile_id, deck_size, round_date)
  where is_paid = false;

-- ============================================================================
-- Fin de la migración pay-to-play.
-- ============================================================================
