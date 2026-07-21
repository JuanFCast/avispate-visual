-- ============================================================================
-- Avíspate · Fase 2 (Supabase) · Esquema inicial: perfiles y puntajes
-- ----------------------------------------------------------------------------
-- Ejecutar completo en Supabase → SQL Editor → Run.
-- Idempotente: se puede volver a correr sin romper nada.
--
-- Diseño:
--   * profiles: un jugador = identidad de Privy (privy_id) + wallet embebida +
--     alias visible en el ranking.
--   * scores: historial COMPLETO (una fila por partida terminada).
--   * El ranking (mejor resultado por jugador y tamaño de mazo) se resuelve por
--     consulta en el código; aquí guardamos todo el historial.
--   * Escritura solo desde el backend (service role, que bypassa RLS) tras
--     verificar el token de Privy. El navegador solo puede LEER.
-- ============================================================================

create extension if not exists pgcrypto;  -- para gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. PERFILES: identidad Privy + wallet + alias
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key default gen_random_uuid(),
  privy_id       text not null unique,            -- did:privy:... (identidad estable)
  wallet_address text unique,                     -- wallet embebida EVM (minúsculas)
  alias          text,                            -- nombre visible en el ranking
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint alias_len check (alias is null or char_length(alias) between 2 and 20)
);

-- Alias único SIN distinguir mayúsculas/minúsculas ("Juan" == "juan").
-- Parcial: permite múltiples perfiles aún sin alias (alias null).
create unique index if not exists profiles_alias_lower_key
  on public.profiles (lower(alias))
  where alias is not null;

-- ----------------------------------------------------------------------------
-- 2. PUNTAJES: una fila por partida terminada (historial completo)
-- ----------------------------------------------------------------------------
create table if not exists public.scores (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  client_game_id uuid not null unique,            -- idempotencia: evita duplicados por reintento/doble envío
  deck_size      smallint not null check (deck_size in (10, 15, 20)),
  total_ms       integer  not null check (total_ms   >= 0),
  average_ms     integer  not null check (average_ms >= 0),
  errors         smallint not null check (errors     >= 0),
  accuracy       smallint not null check (accuracy between 0 and 100),
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. ÍNDICES
-- ----------------------------------------------------------------------------
-- Orden del ranking: por mazo, menor promedio, y a menor error como desempate.
create index if not exists scores_ranking_idx
  on public.scores (deck_size, average_ms asc, errors asc);

-- Búsqueda de todas las partidas de un jugador.
create index if not exists scores_profile_idx
  on public.scores (profile_id);

-- ----------------------------------------------------------------------------
-- 4. updated_at automático en profiles (función + trigger)
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. RLS: lectura pública del ranking, escritura SOLO desde el servidor
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.scores   enable row level security;

-- Lectura pública (el ranking muestra alias + wallet abreviada).
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
  for select using (true);

drop policy if exists scores_public_read on public.scores;
create policy scores_public_read on public.scores
  for select using (true);

-- NO se crean políticas de INSERT / UPDATE / DELETE:
-- con RLS activo y sin esas políticas, anon y authenticated NO pueden escribir.
-- El backend escribe con la SERVICE ROLE KEY (bypassa RLS) tras verificar Privy.

-- ============================================================================
-- Fin del esquema inicial.
-- ============================================================================
