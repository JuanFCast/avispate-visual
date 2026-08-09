-- ============================================================================
-- Avíspate · Arena: DUELOS GANADOS
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- ── Qué estaba mal ─────────────────────────────────────────────────────────
--
-- La pantalla final decía "Manos tomadas" y enseñaba la suma de `correct`, o
-- sea CADA carta que alguien puso sobre la base. Eso no es una disputa: en una
-- partida tranquila, donde nadie compite por la misma jugada, esa cifra sube
-- igual. "Manos tomadas: 12" contaba doce jugadas normales.
--
-- Lo que de verdad se quería medir es otra cosa y es la más interesante del
-- juego: **dos o más jugadores van a por la misma carta casi a la vez, y el
-- servidor decide quién llegó primero.** Eso es un duelo, y solo lo gana uno.
--
-- ── Dónde se ve un duelo ───────────────────────────────────────────────────
--
-- Aquí dentro y en ningún otro sitio. `move_seq` es la versión de la base: una
-- jugada solo entra si trae el número que la partida tiene AHORA. Cuando dos
-- tocan sobre la misma base, el cerrojo los pone en fila; el primero sube el
-- `move_seq` y el segundo se encuentra con que ya cambió y se va con `stale`.
--
-- Ese `stale` es la huella del duelo — pero llega DESPUÉS, en la petición del
-- que perdió. Por eso el duelo no se puede contar cuando se gana: hay que
-- anotar quién se llevó la base y esperar a ver si alguien reclama esa misma
-- base. Para eso son las tres columnas nuevas de `arena_matches`.
--
-- ── Qué NO cuenta como duelo ───────────────────────────────────────────────
--
--   · Una carta tomada sin que nadie la disputara. Es lo que pedía el cambio.
--   · Un `stale` que llega tarde de verdad. Si tocaste dos segundos después de
--     que la base cambiara no estabas compitiendo, ibas atrasado. La ventana
--     (`c_duel_window`) separa una cosa de la otra.
--   · Un `stale` que va dos o más jugadas atrás (`p_seq < move_seq - 1`): eso
--     es una pantalla vieja, no una carrera.
--   · Tus propios toques repetidos. Un doble toque manda dos peticiones; la
--     segunda llega `stale` contra tu propia jugada. Sin el cheque de
--     `base_taken_by <> p_profile` te estarías ganando duelos a ti mismo.
--
-- ── El reloj es el del servidor ────────────────────────────────────────────
--
-- La ventana se mide con `now()` de Postgres, entre el instante en que la base
-- se movió y el instante en que llega el reclamo. El navegador no manda ningún
-- tiempo y no podría: nada de lo que diga entra en esta cuenta. Es la misma
-- regla que ya gobierna el resto de la partida.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUMNAS
-- ----------------------------------------------------------------------------

alter table public.arena_match_players
  -- Duelos que este jugador GANÓ: veces que se llevó una carta que otro estaba
  -- reclamando en ese mismo instante.
  add column if not exists duels_won smallint not null default 0;

alter table public.arena_matches
  -- Cuándo se movió la base a lo que es ahora, según el reloj del SERVIDOR.
  add column if not exists base_taken_at  timestamptz,
  -- Quién se la llevó. Es a quien se le apunta el duelo si alguien la reclama.
  add column if not exists base_taken_by  uuid references public.profiles(id) on delete set null,
  -- ¿Ya se contó un duelo por ESTA base? Un duelo por jugada disputada, no uno
  -- por cada rival que llegó tarde: con cuatro en la mesa, ganar una carrera
  -- sigue siendo ganar una carrera.
  add column if not exists base_duel_counted boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. LA JUGADA, CON EL DUELO DENTRO DEL MISMO CERROJO
-- ----------------------------------------------------------------------------
-- Se reemplaza entera (`create or replace` conserva los permisos ya dados).
-- Lo unico que cambia respecto de la version de `20260801000000` son las dos
-- marcas: contar el duelo en la rama `stale`, y sellar la base al ganarla.
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
  v_duel       boolean := false;
  -- Cuánto puede tardar un reclamo en llegar y seguir siendo una carrera.
  --
  -- Es el margen entre que la base se mueve en el servidor y que entra el toque
  -- del rival: su tiempo de reaccion ya transcurrido mas lo que tarde su red.
  -- 1,5 s es generoso con una conexion movil mala y sigue siendo corto para lo
  -- que importa: quien toca dos segundos tarde no estaba compitiendo.
  c_duel_window constant interval := interval '1500 milliseconds';
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
    -- Llegó contra una base que ya cambió. Si cambió HACE UN INSTANTE y fue
    -- otro quien se la llevó, esto no es un retraso: es el otro lado de un
    -- duelo, y el duelo se le apunta a quien lo gano.
    if      p_seq = v_match.move_seq - 1
        and v_match.base_taken_by is not null
        and v_match.base_taken_by <> p_profile
        and not v_match.base_duel_counted
        and v_match.base_taken_at is not null
        and now() - v_match.base_taken_at <= c_duel_window
    then
      update public.arena_match_players
         set duels_won = duels_won + 1
       where match_id = p_match and profile_id = v_match.base_taken_by;

      update public.arena_matches
         set base_duel_counted = true
       where id = p_match;

      v_duel := true;
    end if;

    return jsonb_build_object(
      'outcome', 'stale', 'seq', v_match.move_seq, 'duel_lost', v_duel
    );
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
  -- Esto NO es un duelo: la base no se movió, así que no hubo carrera por ella.
  if v_player.deck[1] <> p_card then
    return jsonb_build_object('outcome', 'stale', 'seq', v_match.move_seq);
  end if;

  if p_correct then
    update public.arena_match_players
       set deck = v_player.deck[2:], correct = correct + 1, last_seen_at = now()
     where id = v_player.id
     returning coalesce(array_length(deck, 1), 0) into v_left;

    -- La base pasa a ser esta carta, y queda SELLADA: quién se la llevó y
    -- cuándo, por el reloj del servidor. Es lo que permite reconocer el duelo
    -- si alguien reclama esta misma base en el siguiente instante.
    -- `base_duel_counted` vuelve a false: base nueva, duelo nuevo.
    update public.arena_matches
       set base_card = p_card,
           move_seq = move_seq + 1,
           base_taken_at = now(),
           base_taken_by = p_profile,
           base_duel_counted = false
     where id = p_match
     returning move_seq into v_new_seq;

    if v_left = 0 then
      v_won := true;
      update public.arena_match_players set finished_at = now() where id = v_player.id;
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
  -- solo que este jugador ahora carga una carta más. Tampoco se toca el sello
  -- de la base — no la gano nadie nuevo, asi que no hay duelo que reasignar.
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

revoke all on function public.arena_apply_move(uuid, uuid, integer, smallint, boolean, smallint) from public, anon, authenticated;
grant execute on function public.arena_apply_move(uuid, uuid, integer, smallint, boolean, smallint) to service_role;

-- ============================================================================
-- Fin.
-- ============================================================================
