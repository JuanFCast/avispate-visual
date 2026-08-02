/**
 * La partida de Arena contra la base de datos. SOLO servidor.
 *
 * El reparto de responsabilidades, que es lo que importa entender aquí:
 *
 *   · La REGLA del juego vive en TypeScript, en este archivo: qué carta tienes
 *     en la mano, cuál es el símbolo que comparte con la base y si el que
 *     tocaste era ese. Se calcula con el mazo derivado de la semilla, que el
 *     navegador no conoce entero.
 *   · La CONSISTENCIA vive en SQL, en `arena_apply_move`: el cerrojo sobre la
 *     partida, el orden de dos toques simultáneos y el ganador único.
 *
 * Cada mitad está en el idioma donde se expresa sin pelear. Lo que nunca pasa
 * es que el navegador decida ninguna de las dos.
 */

import {
  PLANE_CARDS,
  buildMatchDeck,
  dealtCards,
  deckModeFor,
  isDealValid,
  sharedSymbol,
  type DeckMode,
} from "../arena-deck";
import {
  ABANDON_MS,
  COUNTDOWN_MS,
  RIVAL_STALE_MS,
  type MatchError,
  type MatchPlayerView,
  type MatchView,
  type MoveOutcome,
} from "../arena-match";
import { initialOf, shortWallet } from "../arena-rooms";
import { getRoomByCode, roomIsLive } from "./arena-rooms";
import { getSupabaseAdmin } from "./server";

interface MatchRow {
  id: string;
  room_id: string;
  code: string;
  seed: string;
  base_card: number;
  move_seq: number;
  starts_at: string;
  finished_at: string | null;
  winner_profile_id: string | null;
  end_reason: "cleared" | "abandoned" | null;
  deck_mode: DeckMode;
  cards_per_player: number;
}

interface MatchPlayerRow {
  id: string;
  profile_id: string;
  seat: number;
  deck: number[];
  correct: number;
  errors: number;
  penalties: number;
  finished_at: string | null;
  left_at: string | null;
  last_seen_at: string;
  profiles: { alias: string | null; wallet_address: string | null } | null;
}

const MATCH_COLUMNS =
  "id, room_id, code, seed, base_card, move_seq, starts_at, finished_at, winner_profile_id, end_reason, deck_mode, cards_per_player";

const PLAYER_COLUMNS =
  "id, profile_id, seat, deck, correct, errors, penalties, finished_at, left_at, last_seen_at, profiles(alias, wallet_address)";

const UNIQUE_VIOLATION = "23505";

export type MatchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MatchError };

const fail = (error: MatchError): { ok: false; error: MatchError } => ({
  ok: false,
  error,
});

async function getMatchByCode(code: string): Promise<MatchRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_matches")
    .select(MATCH_COLUMNS)
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as MatchRow | null) ?? null;
}

async function listMatchPlayers(matchId: string): Promise<MatchPlayerRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_match_players")
    .select(PLAYER_COLUMNS)
    .eq("match_id", matchId)
    .order("seat", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MatchPlayerRow[];
}

/**
 * Arma la partida de una sala llena y lista. Idempotente por el único de
 * `room_id`: el anfitrión puede tocar dos veces, o reintentar tras un timeout,
 * y sigue habiendo un solo mazo repartido.
 */
export async function startMatch(params: {
  code: string;
  hostProfileId: string;
}): Promise<MatchResult<MatchRow>> {
  const db = getSupabaseAdmin();

  // El permiso se comprueba SIEMPRE, incluso cuando la partida ya existe.
  // Devolver la que hay antes de mirar quién pregunta dejaría la autorización
  // sin evaluar en el camino más recorrido, que es justo donde no se nota.
  const room = await getRoomByCode(params.code);
  if (!room) return fail("no_match");
  if (room.host_profile_id !== params.hostProfileId) return fail("not_host");

  const existing = await getMatchByCode(params.code);
  if (existing) return { ok: true, value: existing };

  if (!roomIsLive(room)) return fail("room_not_ready");

  const { data: seated, error: seatedError } = await db
    .from("arena_room_players")
    .select("profile_id, seat, is_ready, last_seen_at")
    .eq("room_id", room.id)
    .order("seat", { ascending: true });
  if (seatedError) throw seatedError;

  const players = (seated ?? []) as {
    profile_id: string;
    seat: number;
    is_ready: boolean;
    last_seen_at: string;
  }[];

  // La mesa tiene que estar exactamente llena y con todos listos: el botón del
  // anfitrión ya lo exige, pero el botón es del navegador.
  if (players.length !== room.max_players) return fail("room_not_ready");
  if (!players.every((p) => p.is_ready)) return fail("room_not_ready");

  // El reparto se vuelve a validar aquí aunque la sala se creara validando: si
  // alguna vez se pudiera editar una sala, o cambiara la fórmula, repartir
  // cartas que el plano no tiene sería un error silencioso y sin arreglo.
  const perPlayer = room.cards_per_player;
  if (!isDealValid(perPlayer, room.max_players)) return fail("room_not_ready");

  const seed = crypto.randomUUID();
  const { data, error } = await db
    .from("arena_matches")
    .insert({
      room_id: room.id,
      code: room.code,
      seed,
      // La partida guarda lo que de verdad repartió, no lo que la sala decía:
      // una partida terminada no se reescribe si mañana cambia la fórmula.
      cards_per_player: perPlayer,
      deck_mode: deckModeFor(perPlayer, room.max_players),
      // El mazo ya viene barajado por la semilla: la carta 0 es la base y los
      // tramos siguientes son las manos. Repartir es cortar, no sortear.
      base_card: 0,
      starts_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
    })
    .select(MATCH_COLUMNS)
    .single();

  if (error) {
    // Otro intento del anfitrión ganó la carrera: sirve el suyo.
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await getMatchByCode(params.code);
      if (raced) return { ok: true, value: raced };
    }
    throw error;
  }

  const match = data as MatchRow;
  // Cortes consecutivos del mazo barajado: la carta 0 es la base y cada jugador
  // se lleva el tramo siguiente. Sin solapes y con el mismo tamaño para todos.
  const hands = players.map((p, i) => ({
    match_id: match.id,
    profile_id: p.profile_id,
    seat: i,
    deck: Array.from({ length: perPlayer }, (_, k) => 1 + i * perPlayer + k),
  }));

  const { error: handError } = await db.from("arena_match_players").insert(hands);
  if (handError) throw handError;

  return { ok: true, value: match };
}

function toPlayerView(
  row: MatchPlayerRow,
  viewerId: string | null,
  now: number
): MatchPlayerView {
  const name = row.profiles?.alias ?? shortWallet(row.profiles?.wallet_address);
  return {
    profileId: row.profile_id,
    name,
    initial: initialOf(name),
    seat: row.seat,
    cardsLeft: row.deck.length,
    correct: row.correct,
    errors: row.errors,
    penalties: row.penalties,
    online: now - new Date(row.last_seen_at).getTime() < RIVAL_STALE_MS,
    left: row.left_at !== null,
    finished: row.finished_at !== null,
    isYou: row.profile_id === viewerId,
  };
}

/**
 * Cierra la partida cuando uno de los dos ya no volvió. Se comprueba al leer
 * porque no hay nadie más a quien preguntarle: el que se fue no va a avisar, y
 * el que se quedó merece un final en vez de una espera infinita.
 */
async function closeIfAbandoned(
  match: MatchRow,
  players: MatchPlayerRow[],
  now: number
): Promise<MatchRow> {
  if (match.finished_at) return match;
  if (now < new Date(match.starts_at).getTime()) return match;

  const isGone = (p: MatchPlayerRow) =>
    p.left_at !== null || now - new Date(p.last_seen_at).getTime() > ABANDON_MS;

  const standing = players.filter((p) => !isGone(p) && p.finished_at === null);

  // Con gente de sobra la partida sigue: que uno se caiga de una mesa de cuatro
  // no es motivo para cerrarla a los otros tres. Solo cuando queda uno solo hay
  // que dar un final, porque no le queda contra quién correr.
  if (standing.length > 1) return match;
  if (standing.length === players.length) return match;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_matches")
    .update({
      finished_at: new Date().toISOString(),
      winner_profile_id: standing[0]?.profile_id ?? null,
      end_reason: "abandoned",
    })
    .eq("id", match.id)
    .is("finished_at", null)
    .select(MATCH_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as MatchRow | null) ?? (await getMatchByCode(match.code)) ?? match;
}

async function touchMatchPlayer(playerRowId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("arena_match_players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", playerRowId);
  if (error) throw error;
}

/**
 * La partida como la pinta la pantalla.
 *
 * Manda los símbolos de DOS cartas —la base y la tuya— y ni uno más. Ni la
 * semilla, ni el mazo, ni la mano del rival: con la semilla, un cliente
 * modificado podría calcular el mazo entero y saber qué le va a tocar al otro.
 */
export async function readMatch(params: {
  code: string;
  viewerProfileId: string | null;
  touch?: boolean;
}): Promise<MatchResult<MatchView>> {
  let match = await getMatchByCode(params.code);
  if (!match) return fail("no_match");

  let players = await listMatchPlayers(match.id);
  const now = Date.now();

  const mine = params.viewerProfileId
    ? players.find((p) => p.profile_id === params.viewerProfileId)
    : undefined;
  if (params.touch && mine && !match.finished_at) {
    await touchMatchPlayer(mine.id);
    mine.last_seen_at = new Date().toISOString();
  }

  const closed = await closeIfAbandoned(match, players, now);
  if (closed !== match) {
    match = closed;
    players = await listMatchPlayers(match.id);
  }

  const cards = buildMatchDeck(match.seed);
  const views = players.map((p) => toPlayerView(p, params.viewerProfileId ?? null, now));
  const you = views.find((v) => v.isYou) ?? null;
  const rivals = views.filter((v) => !v.isYou);

  const myRow = players.find((p) => p.profile_id === params.viewerProfileId);
  const myCard = myRow && myRow.deck.length > 0 ? myRow.deck[0] : null;

  return {
    ok: true,
    value: {
      code: match.code,
      phase: match.finished_at
        ? "finished"
        : now < new Date(match.starts_at).getTime()
          ? "countdown"
          : "playing",
      seq: match.move_seq,
      baseCard: match.base_card,
      baseSymbols: cards[match.base_card],
      myCard,
      mySymbols: myCard === null ? null : cards[myCard],
      startsAt: match.starts_at,
      serverNow: new Date().toISOString(),
      finishedAt: match.finished_at,
      winnerProfileId: match.winner_profile_id,
      endReason: match.end_reason,
      cardsPerPlayer: match.cards_per_player,
      you,
      rivals,
    },
  };
}

/**
 * La carta que cae por fallar.
 *
 * Empieza por la RESERVA: las cartas del plano que no se repartieron. Cuántas
 * son depende de la mesa —36 en una partida rápida de dos, solo 2 en una
 * completa— y por eso el punto de partida es `dealt` y no un número fijo.
 *
 * Agotada la reserva, sigue dando la vuelta y recicla descartes. Eso es seguro
 * por construcción: dos cartas cualesquiera del plano comparten exactamente un
 * símbolo, así que una carta reciclada encaja con la base igual que una nueva.
 * Las dos únicas que no valen son la base (contra sí misma comparte los ocho y
 * no habría respuesta única) y una que el jugador ya tenga en la mano.
 */
function pickPenaltyCard(
  deck: number[],
  baseCard: number,
  spins: number,
  dealt: number
): number {
  const held = new Set(deck);
  for (let i = 0; i < PLANE_CARDS; i++) {
    const card = (dealt + spins + i) % PLANE_CARDS;
    if (card !== baseCard && !held.has(card)) return card;
  }
  // Mazo imposible (tendría 56 cartas en la mano). Cualquiera que no sea la
  // base sigue siendo jugable.
  return (baseCard + 1) % PLANE_CARDS;
}

export interface MoveResult {
  outcome: MoveOutcome;
  /** El símbolo que SÍ era, cuando el servidor confirma el acierto. */
  matchedSymbol: string | null;
  view: MatchView;
}

/**
 * Juzga un toque y lo aplica.
 *
 * El cliente manda contra qué base creía estar jugando (`seq`) y qué carta
 * creía tener (`card`). Las dos cosas se comprueban: la primera aquí y otra vez
 * dentro del cerrojo, la segunda solo dentro del cerrojo. Si algo cambió en el
 * camino la jugada se descarta como `stale`, que no cuesta carta ni castigo.
 */
export async function applyMove(params: {
  code: string;
  profileId: string;
  seq: number;
  card: number;
  symbolId: string;
}): Promise<MatchResult<MoveResult>> {
  const db = getSupabaseAdmin();
  const match = await getMatchByCode(params.code);
  if (!match) return fail("no_match");

  const players = await listMatchPlayers(match.id);
  const mine = players.find((p) => p.profile_id === params.profileId);
  if (!mine) return fail("not_playing");

  const finish = async (outcome: MoveOutcome, matchedSymbol: string | null) => {
    const view = await readMatch({
      code: params.code,
      viewerProfileId: params.profileId,
      touch: true,
    });
    if (!view.ok) return view;
    return { ok: true as const, value: { outcome, matchedSymbol, view: view.value } };
  };

  // Toque contra una base que ya cambió, o con una carta que ya no tiene: no se
  // juzga. Sería injusto castigar por mirar una foto vieja.
  if (match.move_seq !== params.seq || mine.deck[0] !== params.card) {
    return finish("stale", null);
  }

  const cards = buildMatchDeck(match.seed);
  const expected = sharedSymbol(cards[params.card], cards[match.base_card]);
  const correct = expected !== null && expected === params.symbolId;

  const { data, error } = await db.rpc("arena_apply_move", {
    p_match: match.id,
    p_profile: params.profileId,
    p_seq: params.seq,
    p_card: params.card,
    p_correct: correct,
    p_penalty_card: pickPenaltyCard(
      mine.deck,
      match.base_card,
      mine.penalties,
      dealtCards(match.cards_per_player, players.length)
    ),
  });
  if (error) throw error;

  const outcome = ((data as { outcome?: string } | null)?.outcome ??
    "no_match") as MoveOutcome;
  return finish(outcome, outcome === "ok" ? expected : null);
}

/** El jugador abandona. El que se queda gana; no hay a quién esperar. */
export async function leaveMatch(params: {
  code: string;
  profileId: string;
}): Promise<MatchResult<MatchView>> {
  const db = getSupabaseAdmin();
  const match = await getMatchByCode(params.code);
  if (!match) return fail("no_match");

  const { error } = await db
    .from("arena_match_players")
    .update({ left_at: new Date().toISOString() })
    .eq("match_id", match.id)
    .eq("profile_id", params.profileId)
    .is("left_at", null);
  if (error) throw error;

  return readMatch({ code: params.code, viewerProfileId: params.profileId });
}

/** ¿Esta sala ya tiene partida? La sala lo usa para llevar a los dos a ella. */
export async function matchExistsForRoom(roomId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { count, error } = await db
    .from("arena_matches")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
