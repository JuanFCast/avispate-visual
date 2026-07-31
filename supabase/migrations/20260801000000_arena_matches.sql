-- ============================================================================
-- Avíspate · Arena: la primera partida de verdad (2 jugadores, sin dinero)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Qué guarda:
--   Una partida = una semilla, una base compartida y dos mazos. Las cartas NO
--   están aquí: se derivan de `seed` con `lib/arena-deck.ts`, que es puro y da
--   el mismo resultado en el servidor y en los dos teléfonos. Guardar 55 cartas
--   de geometría por partida sería guardar algo que ya sabemos calcular.
--
--   Los mazos son arreglos de índices 0..56 sobre ese mazo derivado. La primera
--   posición es la carta que el jugador tiene en la mano.
--
-- Qué NO guarda: dinero. Ni entrada cobrada, ni pozo, ni premio. Esta fase es
-- para comprobar que la base compartida, los simultáneos y el ganador cuadran
-- entre dos dispositivos reales.
--
-- El reloj es el del servidor (`now()`), nunca el del navegador: el navegador
-- del jugador es justamente lo que no podemos creerle.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LA PARTIDA
-- ----------------------------------------------------------------------------
create table if not exists public.arena_matches (
  id                uuid primary key default gen_random_uuid(),
  -- Una sala, una partida. El único hace que "iniciar" dos veces (doble toque
  -- del anfitrión, reintento de red) no reparta dos mazos distintos.
  room_id           uuid not null unique references public.arena_rooms(id) on delete cascade,
  code              text not null,
  seed              text not null,
  -- Índice 0..56 de la carta que ahora mismo es la base de los dos.
  base_card         smallint not null,
  -- Versión de la base. Es el árbitro de los simultáneos: una jugada solo entra
  -- si trae el número que el servidor tiene AHORA, así que de dos toques a la
  -- vez uno gana y el otro se entera de que la base ya cambió.
  move_seq          integer not null default 0,
  -- Fin de la cuenta regresiva. Antes de esta hora no se admite ninguna jugada.
  starts_at         timestamptz not null,
  finished_at       timestamptz,
  winner_profile_id uuid references public.profiles(id) on delete set null,
  end_reason        text check (end_reason in ('cleared', 'abandoned')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists arena_matches_code_idx on public.arena_matches (code);

-- El ganador se borra en blando, nunca bloquea. Sin esto, un perfil que ganó
-- una vez no se puede borrar jamás: la fila de la partida lo retiene y falla el
-- borrado entero (23503). Va suelto además de en el `create table` para
-- arreglar las bases donde la tabla ya existía sin la regla.
alter table public.arena_matches
  drop constraint if exists arena_matches_winner_profile_id_fkey;
alter table public.arena_matches
  add constraint arena_matches_winner_profile_id_fkey
  foreign key (winner_profile_id) references public.profiles(id) on delete set null;

drop trigger if exists arena_matches_set_updated_at on public.arena_matches;
create trigger arena_matches_set_updated_at
  before update on public.arena_matches
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. LOS DOS JUGADORES
-- ----------------------------------------------------------------------------
create table if not exists public.arena_match_players (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.arena_matches(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)      on delete cascade,
  seat         smallint not null check (seat between 0 and 1),
  -- Cartas que le quedan, en orden. deck[1] es la que tiene en la mano y las de
  -- castigo entran por el final.
  deck         smallint[] not null,
  correct      smallint not null default 0,
  errors       smallint not null default 0,
  penalties    smallint not null default 0,
  finished_at  timestamptz,
  left_at      timestamptz,
  last_seen_at timestamptz not null default now(),
  unique (match_id, profile_id),
  unique (match_id, seat)
);

create index if not exists arena_match_players_profile_idx
  on public.arena_match_players (profile_id);

-- ----------------------------------------------------------------------------
-- 3. LA JUGADA, EN UNA SOLA TRANSACCIÓN
-- ----------------------------------------------------------------------------
-- Por qué esto vive en SQL y no en la ruta de /api:
--
--   Una jugada correcta son DOS escrituras que tienen que ocurrir juntas o no
--   ocurrir: la base pasa a ser tu carta Y esa carta sale de tu mazo. Partidas
--   en dos llamadas desde Node, entre una y otra cabe la jugada del rival —y el
--   resultado sería una base que nadie tiene o una carta gastada dos veces.
--
--   Aquí el `for update` sobre la fila de la partida serializa a los dos
--   jugadores: el segundo espera, ve el `move_seq` ya movido y se va con
--   `stale`. Nadie pierde una carta por haber tocado tarde.
--
-- Qué NO decide esta función: si el símbolo era el correcto. Eso lo calcula el
-- servidor en `/api/arena/matches/[code]/move` con el mazo derivado de la
-- semilla, y llega aquí ya resuelto en `p_correct`. La regla del juego vive en
-- TypeScript, junto al mazo; la consistencia vive aquí, junto a las filas.
--
-- `stale` NO es un error del jugador: tocó bien, pero contra una base que ya
-- había cambiado. No se le quita carta ni se le suma castigo — vuelve a mirar.
create or replace function public.arena_apply_move(
  p_match        uuid,
  p_profile      uuid,
  p_seq          integer,
  p_card         smallint,
  p_correct      boolean,
  p_penalty_card smallint
) returns jsonb
language plpgsql
as $$
declare
  v_match      public.arena_matches%rowtype;
  v_player     public.arena_match_players%rowtype;
  v_left       integer;
  v_new_seq    integer;
  v_won        boolean := false;
begin
  -- El cerrojo. Todo lo de abajo pasa con la partida quieta.
  select * into v_match from public.arena_matches
    where id = p_match for update;
  if not found then
    return jsonb_build_object('outcome', 'no_match');
  end if;
  if v_match.finished_at is not null then
    return jsonb_build_object('outcome', 'finished', 'seq', v_match.move_seq);
  end if;
  if now() < v_match.starts_at then
    return jsonb_build_object('outcome', 'too_early', 'seq', v_match.move_seq);
  end if;
  if v_match.move_seq <> p_seq then
    return jsonb_build_object('outcome', 'stale', 'seq', v_match.move_seq);
  end if;

  select * into v_player from public.arena_match_players
    where match_id = p_match and profile_id = p_profile for update;
  if not found or v_player.left_at is not null then
    return jsonb_build_object('outcome', 'not_playing', 'seq', v_match.move_seq);
  end if;
  if coalesce(array_length(v_player.deck, 1), 0) = 0 then
    return jsonb_build_object('outcome', 'finished', 'seq', v_match.move_seq);
  end if;
  -- La carta que dice tener en la mano ya no es la que tiene: llegó tarde.
  if v_player.deck[1] <> p_card then
    return jsonb_build_object('outcome', 'stale', 'seq', v_match.move_seq);
  end if;

  if p_correct then
    update public.arena_match_players
       set deck = v_player.deck[2:], correct = correct + 1, last_seen_at = now()
     where id = v_player.id
     returning coalesce(array_length(deck, 1), 0) into v_left;

    update public.arena_matches
       set base_card = p_card, move_seq = move_seq + 1
     where id = p_match
     returning move_seq into v_new_seq;

    if v_left = 0 then
      v_won := true;
      update public.arena_match_players set finished_at = now() where id = v_player.id;
      -- `winner_profile_id is null` es la última barrera contra el empate
      -- técnico: si los dos vaciaran a la vez, el cerrojo ya los puso en fila y
      -- el segundo se encuentra el ganador puesto.
      update public.arena_matches
         set finished_at = now(),
             winner_profile_id = coalesce(winner_profile_id, p_profile),
             end_reason = 'cleared'
       where id = p_match;
    end if;

    return jsonb_build_object(
      'outcome', 'ok', 'seq', v_new_seq, 'cards_left', v_left, 'won', v_won
    );
  end if;

  -- Falló. No se toca la base ni el `move_seq`: la base es la misma de antes,
  -- solo que este jugador ahora carga una carta más.
  update public.arena_match_players
     set deck = v_player.deck || p_penalty_card,
         errors = errors + 1,
         penalties = penalties + 1,
         last_seen_at = now()
   where id = v_player.id
   returning coalesce(array_length(deck, 1), 0) into v_left;

  return jsonb_build_object(
    'outcome', 'penalty', 'seq', v_match.move_seq, 'cards_left', v_left
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS: igual que las salas — nada desde el navegador
-- ----------------------------------------------------------------------------
-- Sin políticas y con RLS activo, anon no ve ni una fila. Y aquí importa más
-- que en las salas: `deck` es la mano del rival. Si el navegador pudiera leer
-- esta tabla, sabría qué carta tiene el otro antes que él.
alter table public.arena_matches        enable row level security;
alter table public.arena_match_players  enable row level security;

grant all on public.arena_matches       to service_role;
grant all on public.arena_match_players to service_role;

revoke all on function public.arena_apply_move(uuid, uuid, integer, smallint, boolean, smallint) from public, anon, authenticated;
grant execute on function public.arena_apply_move(uuid, uuid, integer, smallint, boolean, smallint) to service_role;

-- ============================================================================
-- Fin.
-- ============================================================================
