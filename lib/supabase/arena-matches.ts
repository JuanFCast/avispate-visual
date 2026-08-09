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
  PAID_ABANDON_MS,
  COUNTDOWN_MS,
  RIVAL_STALE_MS,
  type MatchError,
  type MatchPlayerView,
  type MatchStakes,
  type MatchView,
  type MoveOutcome,
} from "../arena-match";
import { arenaPrize } from "../arena";
import { decideMatchStart } from "../arena-start";
import { paidPlayersOf } from "../arena-escrow";
import { initialOf, shortWallet } from "../arena-rooms";
import { getRoomByCode, roomIsLive } from "./arena-rooms";
import { getSupabaseAdmin } from "./server";
import { settleFinishedMatch } from "./arena-settle-hook";
import { settlementOf } from "./arena-escrow-db";

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
  duels_won: number;
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
  "id, profile_id, seat, deck, correct, duels_won, errors, penalties, finished_at, left_at, last_seen_at, profiles(alias, wallet_address)";

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
  actorProfileId: string;
}): Promise<MatchResult<MatchRow>> {
  const db = getSupabaseAdmin();

  // El permiso se comprueba SIEMPRE, incluso cuando la partida ya existe.
  // Devolver la que hay antes de mirar quién pregunta dejaría la autorización
  // sin evaluar en el camino más recorrido, que es justo donde no se nota.
  const room = await getRoomByCode(params.code);
  if (!room) return fail("no_match");

  /**
   * Quién puede repartir.
   *
   * En una mesa GRATIS, el anfitrión: `host_profile_id` lo fijó la sesión que
   * creó la sala y ahí sigue valiendo, porque no hay dinero de por medio.
   *
   * En una mesa CON ENTRADA, cualquiera que esté sentado — y estar sentado ya
   * significa haber pagado y haber probado la ficha (`arena-actor.ts`). Son dos
   * razones:
   *
   *   · `host_profile_id` sale de la sesión del creador, y con la regla nueva
   *     la silla es de la wallet que pagó. Cuando no son el mismo perfil, atar
   *     el reparto al primero deja la mesa muerta: cuatro entradas pagadas y
   *     nadie que pueda repartir hasta que la mesa venza. Eso es exactamente el
   *     final que estamos quitando de en medio.
   *   · Y aflojarlo no regala nada, porque `decideMatchStart` sigue exigiendo
   *     la mesa exactamente llena, TODOS los sentados en la lista de pagadores
   *     del contrato y TODOS listos. Con esas tres cosas puestas, la partida ya
   *     va a empezar: quién toca el botón deja de ser una decisión con
   *     consecuencias.
   */
  if (room.table_id) {
    const { data: seat, error: seatError } = await db
      .from("arena_room_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("profile_id", params.actorProfileId)
      .maybeSingle();
    if (seatError) throw seatError;
    if (!seat) return fail("not_host");
  } else if (room.host_profile_id !== params.actorProfileId) {
    return fail("not_host");
  }

  const existing = await getMatchByCode(params.code);
  if (existing) return { ok: true, value: existing };

  if (!roomIsLive(room)) return fail("room_not_ready");

  const { data: seated, error: seatedError } = await db
    .from("arena_room_players")
    .select("profile_id, seat, is_ready, last_seen_at, wallet_address")
    .eq("room_id", room.id)
    .order("seat", { ascending: true });
  if (seatedError) throw seatedError;

  const players = (seated ?? []) as {
    profile_id: string;
    seat: number;
    is_ready: boolean;
    last_seen_at: string;
    wallet_address: string | null;
  }[];

  /*
   * El guardia de verdad. El botón deshabilitado de la pantalla es una cortesía
   * para el jugador; una petición armada a mano no ve botones.
   *
   * En una mesa con entrada se le pregunta a la CADENA quién pagó, y no a
   * nuestras filas. Son dos preguntas distintas —"cuánta gente hay sentada" y
   * "cuánta gente puso dinero"— y solo daban la misma respuesta mientras nada
   * pudiera crear una silla sin pago.
   */
  const tableId = room.table_id;
  const verdict = decideMatchStart({
    isHost: true, // el permiso para repartir ya se resolvió arriba
    roomLive: true, // ídem
    maxPlayers: room.max_players,
    seated: players.map((p) => ({
      ready: p.is_ready,
      walletAddress: p.wallet_address,
    })),
    onchainPlayers: tableId
      ? await paidPlayersOf(tableId as `0x${string}`)
      : null,
  });
  if (!verdict.ok) return fail(verdict.error);

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
    // `?? 0` porque una partida empezada ANTES de la migración de duelos no
    // tiene la columna rellena. Cero es la verdad ahí: no se midió ninguno.
    duelsWon: row.duels_won ?? 0,
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
  now: number,
  /**
   * Cuánto se espera sin ver a alguien antes de darlo por ido. Lo decide quien
   * llama porque depende de la mesa: en una con entrada es más largo (90 s
   * contra 45), y perder la entrada por un túnel de cincuenta segundos sería
   * un castigo desproporcionado.
   */
  graceMs: number
): Promise<MatchRow> {
  if (match.finished_at) return match;
  if (now < new Date(match.starts_at).getTime()) return match;

  const isGone = (p: MatchPlayerRow) =>
    p.left_at !== null || now - new Date(p.last_seen_at).getTime() > graceMs;

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

/**
 * Dispara la liquidación de una partida que acaba de cerrarse.
 *
 * Vive aquí y no en la ruta porque las partidas se cierran desde dos sitios —el
 * mazo vacío y el abandono— y sería cuestión de tiempo que alguien añadiera un
 * tercero y se olvidara de pagar. Nunca lanza: un fallo moviendo dinero no
 * puede tumbar la lectura de la partida, y para eso está el reintento.
 */
async function settleClosedMatch(match: MatchRow): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("arena_rooms")
      .select("id, table_id, entry_units, max_players")
      .eq("id", match.room_id)
      .maybeSingle();
    if (!data?.table_id) return;
    // Ya liquidada: la mayoría de las llamadas mueren aquí, que es lo que hace
    // barato mirarlo en cada lectura de una partida terminada.
    if (await settlementOf(data.table_id as string)) return;

    await settleFinishedMatch({
      roomId: data.id as string,
      tableId: data.table_id as string,
      entryUnits: BigInt(data.entry_units as string),
      maxPlayers: Number(data.max_players),
      winnerProfileId: match.winner_profile_id,
      reason: match.end_reason,
    });
  } catch {
    // El cron la retoma.
  }
}

interface RoomTerms {
  id: string;
  tableId: string | null;
  entryUnits: bigint;
  maxPlayers: number;
}

/**
 * Las condiciones de la mesa donde se juega esta partida.
 *
 * Una sola lectura para dos preguntas que antes se hacían por separado: cuánto
 * se espera antes de dar a alguien por ido (más en una mesa con entrada) y qué
 * hay en juego, que es lo que la pantalla de resultados necesita para decir una
 * cifra en vez de un "sin premio" genérico.
 *
 * Devuelve `null` si no se pudo leer. Quien llama decide qué hacer con eso; el
 * margen de abandono, por ejemplo, elige el LARGO: equivocarse esperando de más
 * solo retrasa un final, y esperando de menos le quita la entrada a alguien que
 * sí estaba.
 */
async function roomTermsOf(roomId: string): Promise<RoomTerms | null> {
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("arena_rooms")
      .select("id, table_id, entry_units, max_players")
      .eq("id", roomId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      tableId: (data.table_id as string | null) ?? null,
      entryUnits: BigInt(data.entry_units as string),
      maxPlayers: Number(data.max_players),
    };
  } catch {
    return null;
  }
}

/**
 * Terminada la partida, la sala se cierra.
 *
 * Sin esto la mesa se quedaba `open` para siempre, y `findActiveRoom` seguía
 * encontrándola: al volver a la Arena, el jugador veía "Todavía tienes una sala
 * abierta" y "Volver a mi sala" lo devolvía a la partida que acababa de
 * terminar. El aviso decía la verdad de la base de datos y una mentira sobre el
 * juego —esa mesa ya no admite a nadie ni se puede volver a jugar—, y era la
 * pared con la que se topaba el que solo quería otra partida.
 *
 * Las sillas NO se borran: `arena_room_players` es de donde sale la dirección a
 * la que el contrato le paga el premio al ganador (ver `settleFinishedMatch`).
 * Cerrar la sala basta para que deje de contar como abierta, y borrarla
 * costaría el premio.
 *
 * Idempotente por el `.eq("status", "open")`: la segunda lectura no escribe.
 */
async function retireRoomOfMatch(match: MatchRow): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    await db
      .from("arena_rooms")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", match.room_id)
      .eq("status", "open");
  } catch {
    // La sala caduca sola por `ROOM_TTL_MS`. Un fallo aquí retrasa el aviso,
    // no rompe nada, y desde luego no puede tumbar la pantalla de resultados.
  }
}

/**
 * Lo que había en juego, tal como se lo tiene que poder leer el jugador.
 *
 * Va calculado en el servidor y no en la pantalla por una razón concreta: la
 * cifra del premio es una promesa de pago, y una promesa la hace quien puede
 * cumplirla. El navegador tiene la entrada y el número de sillas, sí, pero
 * dejarle la multiplicación significaría que el día que cambie la comisión haya
 * dos verdades sobre cuánto se ganó.
 *
 * El estado del pago solo se consulta con la partida terminada: durante el
 * juego nadie lo mira y sería una consulta por segundo a cambio de nada.
 */
async function stakesOf(
  match: MatchRow,
  terms: RoomTerms | null
): Promise<MatchStakes> {
  // Mesa gratis (o sala ilegible): las cifras van en cero y `paid` en false,
  // que es lo que hace que la pantalla lo diga con letras en vez de enseñar un
  // premio de 0.00 USDT, que se lee como un error.
  if (!terms?.tableId) {
    return {
      entryUnits: terms ? terms.entryUnits.toString() : "0",
      prizeUnits: "0",
      paid: false,
      tableId: null,
      payout: null,
    };
  }

  const prize = arenaPrize(terms.entryUnits, terms.maxPlayers);
  return {
    entryUnits: terms.entryUnits.toString(),
    prizeUnits: prize.winnerUnits.toString(),
    paid: true,
    tableId: terms.tableId,
    payout: match.finished_at ? await payoutOf(terms.tableId) : null,
  };
}

/** El pago del premio: si ya se reclamó y si la cadena lo confirmó. */
async function payoutOf(
  tableId: string
): Promise<{ txHash: string | null } | null> {
  try {
    const row = await settlementOf(tableId);
    return row ? { txHash: row.tx_hash } : null;
  } catch {
    // Sin respuesta se dice "en camino", que es lo cierto, en vez de fingir que
    // no hay premio.
    return null;
  }
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

  const terms = await roomTermsOf(match.room_id);
  // Sin poder leer la sala se asume mesa con entrada: el margen largo.
  const paid = terms ? Boolean(terms.tableId) : true;
  const closed = await closeIfAbandoned(
    match,
    players,
    now,
    paid ? PAID_ABANDON_MS : ABANDON_MS
  );
  if (closed !== match) {
    match = closed;
    players = await listMatchPlayers(match.id);
  }

  /**
   * Partida terminada: si la mesa cobraba, hay dinero que mover.
   *
   * Se mira aquí y no en cada sitio que cierra una partida —el mazo vacío lo
   * hace el RPC, el abandono lo hace `closeIfAbandoned`— porque sería cuestión
   * de tiempo que apareciera un tercer camino y se olvidara de pagar. Sin
   * esperarlo: la pantalla de resultados no tiene por qué mirar a la cadena, y
   * lo que falle lo retoma el cron.
   */
  if (match.finished_at) {
    void settleClosedMatch(match);
    // Y la mesa deja de estar abierta, que es lo que hacía que la Arena
    // siguiera ofreciendo "Volver a mi sala" a una partida ya jugada.
    void retireRoomOfMatch(match);
  }

  const stakes = await stakesOf(match, terms);
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
      stakes,
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
 * creía tener (`card`). Las dos cosas se comprueban DENTRO del cerrojo, en
 * `arena_apply_move`. Si algo cambió en el camino la jugada se descarta como
 * `stale`, que no cuesta carta ni castigo.
 *
 * ── Por qué ya no se adelanta el `stale` aquí ──────────────────────────────
 *
 * Antes había un atajo: si esta lectura —sin cerrojo— veía el `move_seq` ya
 * movido, se devolvía `stale` sin llegar a llamar al RPC. Ahorraba una ida a la
 * base y costaba lo único que no se podía perder: **ese `stale` es la huella de
 * un duelo**, y el duelo solo se puede reconocer dentro del cerrojo, que es el
 * único sitio donde consta quién se llevó la base y en qué instante
 * (`20260809000000_arena_duels.sql`). Cortado aquí, la carrera se resolvia bien
 * pero no la veia nadie.
 *
 * Que el veredicto salga de un solo sitio es además lo correcto por su cuenta:
 * esta lectura y el cerrojo pueden discrepar, y el que manda es el cerrojo.
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

  // El símbolo se calcula contra la foto que tenemos; si esa foto ya envejeció,
  // el cerrojo devolverá `stale` y este cálculo se descarta sin usarse. La regla
  // del juego sigue viviendo aquí, junto al mazo; la carrera se resuelve allá,
  // junto a las filas.
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
