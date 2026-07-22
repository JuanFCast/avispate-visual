-- ============================================================================
-- Avíspate · Liquidaciones de ronda (el #1 de cada mazo cobra el pozo diario)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
-- Registra cada liquidación para: (1) no liquidar dos veces la misma
-- ronda+mazo, (2) historial de ganadores.
-- ============================================================================

create table if not exists public.round_settlements (
  round_date        date     not null,
  deck_size         smallint not null check (deck_size in (10, 15, 20)),
  winner_profile_id uuid     references public.profiles(id) on delete set null,
  winner_wallet     text,
  tx_hash           text,
  amount_units      bigint,
  created_at        timestamptz not null default now(),
  primary key (round_date, deck_size)
);

alter table public.round_settlements enable row level security;

-- Lectura pública (mostrar ganadores pasados); escritura solo backend.
drop policy if exists round_settlements_public_read on public.round_settlements;
create policy round_settlements_public_read on public.round_settlements
  for select using (true);
