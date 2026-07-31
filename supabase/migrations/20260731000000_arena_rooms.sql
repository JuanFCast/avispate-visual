-- ============================================================================
-- Avíspate · Arena: salas privadas (código, mesa y jugadores)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Qué es y qué NO es:
--   Esto guarda una MESA, no una partida. Quién armó la sala, con qué entrada,
--   para cuántos, quién está sentado y quién dijo "listo". No hay cobro, ni
--   bloqueo de fondos, ni estado de juego: cuando la partida exista de verdad
--   vivirá en sus propias tablas y estas dos solo le dirán con quién empezar.
--
--   Por eso tampoco hay columna de dinero movido: `entry_units` es la entrada
--   ACORDADA en el lobby, la misma que se muestra en pantalla para estimar el
--   pozo. Nadie ha pagado nada por estar aquí.
--
-- El código:
--   `AVP-4821`. Cuatro dígitos son 10.000 combinaciones — se dicta por teléfono
--   y se teclea sin errores, que es lo que hace útil a una sala privada, pero
--   NO es un secreto fuerte: quien insista puede probarlas todas. Aguanta
--   mientras entrar a una sala no cueste dinero. Antes de conectar el cobro
--   toca subir la entropía del código (o cerrar la sala con RLS por identidad).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SALAS
-- ----------------------------------------------------------------------------
create table if not exists public.arena_rooms (
  id              uuid primary key default gen_random_uuid(),
  -- "AVP-4821". Único mientras la sala viva; ver la nota de reciclaje abajo.
  code            text not null unique,
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Unidades de USDT (6 decimales), como en todo el resto: 100000 = 0.10 USDT.
  entry_units     bigint   not null check (entry_units > 0),
  max_players     smallint not null check (max_players between 2 and 4),
  -- 'open' = admite gente; 'closed' = el anfitrión se fue o se quedó vacía.
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);

-- Buscar una sala por código es lo que hace el índice único; este otro es para
-- barrer las abiertas que ya nadie va a usar (ver limpieza al final).
create index if not exists arena_rooms_open_idx
  on public.arena_rooms (status, created_at desc);

drop trigger if exists arena_rooms_set_updated_at on public.arena_rooms;
create trigger arena_rooms_set_updated_at
  before update on public.arena_rooms
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. JUGADORES SENTADOS
-- ----------------------------------------------------------------------------
create table if not exists public.arena_room_players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.arena_rooms(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)    on delete cascade,
  -- Silla 0..3. El único de (room_id, seat) es lo que impide que dos jugadores
  -- que tocan "entrar" en el mismo instante ocupen el último lugar: el segundo
  -- choca contra el índice, reintenta y ahí sí ve la sala llena.
  seat         smallint not null check (seat between 0 and 3),
  is_host      boolean  not null default false,
  is_ready     boolean  not null default false,
  joined_at    timestamptz not null default now(),
  -- Latido del cliente. Sin él no hay forma de distinguir a quien cerró la
  -- pestaña de quien sigue mirando la sala: nadie avisa al irse.
  last_seen_at timestamptz not null default now(),
  unique (room_id, profile_id),
  unique (room_id, seat)
);

-- "¿En qué sala está este jugador?" — se pregunta en cada recarga para
-- devolverlo a su mesa, así que va indexado.
create index if not exists arena_room_players_profile_idx
  on public.arena_room_players (profile_id);

-- ----------------------------------------------------------------------------
-- 3. RLS: nada desde el navegador, ni leer ni escribir
-- ----------------------------------------------------------------------------
-- Sin políticas y con RLS activo, anon y authenticated no ven ni una fila. El
-- backend (service_role) es el único que lee y escribe, después de verificar el
-- token de Privy, igual que `plays`. El navegador se entera de los cambios por
-- un canal de broadcast de Realtime que solo dice "algo cambió"; el estado de
-- la sala siempre baja por /api. Por eso estas tablas NO se agregan a la
-- publicación `supabase_realtime`: publicarlas sería repartir todos los códigos
-- activos a cualquiera con la anon key.
alter table public.arena_rooms        enable row level security;
alter table public.arena_room_players enable row level security;

grant all on public.arena_rooms        to service_role;
grant all on public.arena_room_players to service_role;

-- ============================================================================
-- Limpieza (opcional, manual o por cron): salas abiertas que ya nadie usa.
-- Cerrar libera el código para que vuelva a sortearse.
--
--   update public.arena_rooms
--      set status = 'closed', closed_at = now()
--    where status = 'open'
--      and created_at < now() - interval '2 hours';
--
-- El servidor ya trata como cerrada cualquier sala abierta más vieja que ese
-- plazo, así que esto es higiene de la tabla, no una regla de negocio.
-- ============================================================================
