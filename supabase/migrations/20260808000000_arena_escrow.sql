-- ============================================================================
-- Arena con dinero: pagos por silla, liquidaciones y devoluciones.
--
--   Hasta ahora `arena_rooms` guardaba una mesa ACORDADA: `entry_units` era la
--   entrada que se mostraba en pantalla para estimar el pozo, y nadie había
--   pagado nada. Eso lo dice la propia migración de salas. Esto añade lo que
--   faltaba para que la entrada exista de verdad.
--
--   La idempotencia NO se deja a la aplicación: vive en índices únicos. Un
--   reintento —la red que se cae a mitad, el jugador que toca dos veces, el
--   cron que se solapa consigo mismo— tiene que chocar contra la base, no
--   contra un `if` que alguien puede olvidar. Con dinero de por medio, "casi
--   nunca pasa" no es una garantía.
--
--   Tres candados:
--     · una silla por transacción de pago  (`join_tx_hash` único)
--     · una silla por dirección y sala     (`(room_id, wallet_address)` único)
--     · una liquidación por mesa           (`table_id` único en settlements)
--     · una devolución por dirección y mesa (`(table_id, address)` único)
--
--   Idempotente: se puede volver a correr entera.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SALAS: su identificador en el contrato
-- ----------------------------------------------------------------------------

-- El id de la mesa on-chain. Se deriva del código Y de los términos, así que
-- una sala con otra entrada sería otra mesa; se guarda para no recalcularlo en
-- cada consulta y para poder cruzar con la cadena desde SQL.
alter table public.arena_rooms
  add column if not exists table_id text;

-- Nulo mientras la sala sea gratis. Único cuando existe: dos salas no pueden
-- apuntar a la misma mesa del contrato.
create unique index if not exists arena_rooms_table_id_key
  on public.arena_rooms (table_id)
  where table_id is not null;

-- ----------------------------------------------------------------------------
-- 2. SILLAS: quién pagó, con qué transacción
-- ----------------------------------------------------------------------------

alter table public.arena_room_players
  -- La dirección que pagó. Es la identidad de la silla: el perfil dice quién
  -- es la persona, esto dice de quién es el dinero.
  add column if not exists wallet_address text,
  add column if not exists join_tx_hash   text,
  add column if not exists paid_at        timestamptz;

-- Una transacción de pago sienta a UNA silla. Reintentar el registro con el
-- mismo hash choca aquí, que es exactamente lo que se quiere.
create unique index if not exists arena_room_players_join_tx_key
  on public.arena_room_players (join_tx_hash)
  where join_tx_hash is not null;

-- Y una dirección ocupa como mucho una silla por sala. Sin esto, dos pagos de
-- la misma wallet crearían dos sillas y el pozo dejaría de cuadrar con la
-- gente sentada.
create unique index if not exists arena_room_players_wallet_key
  on public.arena_room_players (room_id, wallet_address)
  where wallet_address is not null;

-- ----------------------------------------------------------------------------
-- 3. LIQUIDACIONES: quién ganó y cuánto se pagó
-- ----------------------------------------------------------------------------

create table if not exists public.arena_settlements (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.arena_rooms(id) on delete cascade,
  -- UNA liquidación por mesa. Es el candado que impide pagar dos veces el
  -- mismo pozo si el cron se solapa o alguien reintenta a mano.
  table_id          text not null unique,
  -- `set null` y no `cascade`: si algún día se borra un perfil, la liquidación
  -- tiene que sobrevivir — es el registro de que ese dinero se movió. Misma
  -- razón por la que `arena_matches.winner_profile_id` lo lleva.
  winner_profile_id uuid references public.profiles(id) on delete set null,
  -- La dirección manda sobre el perfil: es a quien le pagó el contrato.
  winner_address    text   not null,
  reason            text   not null check (reason in ('cleared', 'abandoned')),
  prize_units       bigint not null check (prize_units >= 0),
  commission_units  bigint not null check (commission_units >= 0),
  -- Nulo entre que se decide y se confirma en la cadena.
  tx_hash           text unique,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);

create index if not exists arena_settlements_room_idx
  on public.arena_settlements (room_id);

-- ----------------------------------------------------------------------------
-- 4. DEVOLUCIONES: mesa anulada, cada quien recupera lo suyo
-- ----------------------------------------------------------------------------

create table if not exists public.arena_refunds (
  id           uuid primary key default gen_random_uuid(),
  table_id     text   not null,
  address      text   not null,
  amount_units bigint not null check (amount_units > 0),
  tx_hash      text unique,
  created_at   timestamptz not null default now(),
  -- Una devolución por dirección y mesa. Cobrar dos veces la misma entrada
  -- sería sacar dinero de las entradas de los demás.
  unique (table_id, address)
);

-- ----------------------------------------------------------------------------
-- 5. PERMISOS
-- ----------------------------------------------------------------------------

-- Solo el backend escribe aquí. Nada de esto se toca desde el navegador: son
-- los registros de que el dinero se movió.
alter table public.arena_settlements enable row level security;
alter table public.arena_refunds     enable row level security;

grant select, insert, update on public.arena_settlements to service_role;
grant select, insert, update on public.arena_refunds     to service_role;

-- ============================================================================
-- Fin de la migración.
-- ============================================================================
