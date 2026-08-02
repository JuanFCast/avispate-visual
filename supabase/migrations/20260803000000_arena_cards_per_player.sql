-- ============================================================================
-- Avíspate · Arena: la duración de la sala deja de ser un modo y pasa a ser una
-- cifra
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Qué cambia:
--   Hasta ahora la sala guardaba `deck_mode` ('sprint' o 'full') y el número de
--   cartas salía de una tabla. Eran dos botones que solo podían decir 10 o el
--   máximo. Ahora el anfitrión elige el número directamente, entre 10 y lo que
--   quepa: 27 con dos jugadores, 18 con tres y 13 con cuatro.
--
--   El máximo no es una preferencia. El mazo es un plano proyectivo de orden 7
--   —57 cartas, que es lo que hace que dos cartas cualesquiera compartan
--   exactamente un símbolo— y de ahí sale el tope de 55 repartidas contando la
--   base. `floor(54 / jugadores)` es todo el margen que existe.
--
-- Qué NO cambia:
--   `deck_mode` se queda. Se sigue escribiendo, derivada de la cifra, para que
--   las filas viejas y las nuevas signifiquen lo mismo; pero ya no decide nada:
--   quien reparte lee `cards_per_player`. Borrar la columna obligaría a tocar
--   `arena_matches`, que guarda partidas ya jugadas, y una partida terminada no
--   se reescribe.
--
--   Sigue sin haber dinero. Ni aquí ni en ninguna de estas tablas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La sala guarda cuántas cartas reparte
-- ----------------------------------------------------------------------------
alter table public.arena_rooms
  add column if not exists cards_per_player smallint;

-- Las salas que ya existen se rellenan con lo que su modo significaba, para que
-- una sala abierta durante el despliegue reparta exactamente lo que prometió.
update public.arena_rooms
   set cards_per_player = case
         when deck_mode = 'sprint' then 10
         else floor(54.0 / max_players)::smallint
       end
 where cards_per_player is null;

alter table public.arena_rooms
  alter column cards_per_player set default 27;

alter table public.arena_rooms
  alter column cards_per_player set not null;

-- Entre 10 y 27. El máximo real depende de `max_players` y lo comprueba el
-- servidor con la fórmula; aquí solo se blindan los extremos absolutos, que es
-- lo que un CHECK puede saber sin repetir la aritmética del código.
alter table public.arena_rooms
  drop constraint if exists arena_rooms_cards_per_player_check;
alter table public.arena_rooms
  add constraint arena_rooms_cards_per_player_check
  check (cards_per_player between 10 and 27);

-- ----------------------------------------------------------------------------
-- 2. La partida: el mismo suelo de 10
-- ----------------------------------------------------------------------------
-- Nació con `between 1 and 27` porque el modo 'sprint' era el único valor bajo
-- posible. Ahora el mínimo es una regla de producto y conviene que la base la
-- sostenga: una partida de 3 cartas no es una partida.
alter table public.arena_matches
  drop constraint if exists arena_matches_cards_per_player_check;
alter table public.arena_matches
  add constraint arena_matches_cards_per_player_check
  check (cards_per_player between 10 and 27);

-- ============================================================================
-- Fin.
-- ============================================================================
