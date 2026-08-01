-- ============================================================================
-- Avíspate · Arena: cuántas cartas dura una partida
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → Run. Idempotente.
--
-- Qué agrega:
--   La mesa ahora elige TAMBIÉN cuánto dura. "Rápida" reparte 10 cartas por
--   jugador; "Completa" reparte lo máximo que cabe en partes iguales sin pasar
--   de 55 cartas contando la base: 27 con dos jugadores, 18 con tres y 13 con
--   cuatro. Todos reciben exactamente lo mismo.
--
--   Las cartas del plano que no se reparten quedan como reserva de castigos.
--   Cuando se agota, se reciclan descartes: dos cartas cualesquiera del plano
--   comparten exactamente un símbolo, así que reciclar no rompe la partida.
--
-- Por qué `cards_per_player` se guarda además del modo:
--   El modo más el número de jugadores ya determina la cifra, pero la partida
--   es un hecho consumado y su reparto no debería depender de que la fórmula
--   siga siendo la misma dentro de seis meses. Se guarda lo que se repartió.
--
-- Sigue sin haber dinero: esto solo cambia cuántas cartas se dan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La sala guarda la elección del anfitrión
-- ----------------------------------------------------------------------------
alter table public.arena_rooms
  add column if not exists deck_mode text not null default 'full';

alter table public.arena_rooms
  drop constraint if exists arena_rooms_deck_mode_check;
alter table public.arena_rooms
  add constraint arena_rooms_deck_mode_check
  check (deck_mode in ('sprint', 'full'));

-- ----------------------------------------------------------------------------
-- 2. La partida guarda lo que de verdad repartió
-- ----------------------------------------------------------------------------
alter table public.arena_matches
  add column if not exists deck_mode text not null default 'full';

alter table public.arena_matches
  drop constraint if exists arena_matches_deck_mode_check;
alter table public.arena_matches
  add constraint arena_matches_deck_mode_check
  check (deck_mode in ('sprint', 'full'));

alter table public.arena_matches
  add column if not exists cards_per_player smallint not null default 27;

-- 27 es el reparto más grande posible (dos jugadores, completa). Más que eso
-- no cabría en el plano una vez repartida la base.
alter table public.arena_matches
  drop constraint if exists arena_matches_cards_per_player_check;
alter table public.arena_matches
  add constraint arena_matches_cards_per_player_check
  check (cards_per_player between 1 and 27);

-- ----------------------------------------------------------------------------
-- 3. Sillas para cuatro
-- ----------------------------------------------------------------------------
-- La tabla nació con la partida de dos y por eso la silla llegaba hasta 1. El
-- motor ya reparte para 2, 3 y 4; la jugabilidad de 3 y 4 se abre después, pero
-- el esquema no tiene por qué ser lo que lo impida.
alter table public.arena_match_players
  drop constraint if exists arena_match_players_seat_check;
alter table public.arena_match_players
  add constraint arena_match_players_seat_check
  check (seat between 0 and 3);

-- ============================================================================
-- Fin.
-- ============================================================================
