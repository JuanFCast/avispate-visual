/**
 * Salas privadas contra la base de datos. SOLO servidor: usa la service role.
 *
 * Aquí vive todo lo que puede salir mal cuando dos personas tocan el mismo
 * botón a la vez —el último asiento, el anfitrión que se va, la sala que
 * caducó— para que las rutas de `/api` queden como lo que deberían ser: leer la
 * petición, llamar a una de estas funciones y traducir el resultado a JSON.
 *
 * Ninguna función de este archivo cobra, bloquea ni promete dinero.
 */

import {
  PLAYER_DROP_MS,
  PLAYER_STALE_MS,
  ROOM_TTL_MS,
  generateRoomCode,
  initialOf,
  shortWallet,
  type RoomError,
  type RoomPlayerView,
  type RoomStatus,
  type RoomView,
} from "../arena-rooms";
import { deckModeFor, isDealValid, type DeckMode } from "../arena-deck";
import { getSupabaseAdmin } from "./server";
import { escrowConfigured, tableIdFor } from "../arena-escrow";

export interface RoomRow {
  id: string;
  code: string;
  host_profile_id: string;
  entry_units: number | string;
  max_players: number;
  status: RoomStatus;
  created_at: string;
  /** Legado: se escribe derivada de `cards_per_player` y no decide nada. */
  deck_mode: DeckMode;
  cards_per_player: number;
  /** Mesa en el contrato del escrow. `null` = sala gratis, y lo será siempre. */
  table_id: string | null;
}

interface PlayerRow {
  profile_id: string;
  seat: number;
  is_host: boolean;
  is_ready: boolean;
  last_seen_at: string;
  profiles: { alias: string | null; wallet_address: string | null } | null;
}

const ROOM_COLUMNS =
  "id, code, host_profile_id, entry_units, max_players, status, created_at, deck_mode, cards_per_player, table_id";

const PLAYER_COLUMNS =
  "profile_id, seat, is_host, is_ready, last_seen_at, profiles(alias, wallet_address)";

/** 23505 = índice único violado. Es el que arbitra la carrera por el asiento. */
const UNIQUE_VIOLATION = "23505";

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomError };

const fail = (error: RoomError): { ok: false; error: RoomError } => ({
  ok: false,
  error,
});

/**
 * Una sala abierta pero vieja está muerta aunque la columna diga otra cosa: no
 * dependemos de que un cron pase a cerrarla para dejar de dejar entrar gente.
 */
function isExpired(room: RoomRow): boolean {
  return Date.now() - new Date(room.created_at).getTime() > ROOM_TTL_MS;
}

/** ¿Admite gente ahora mismo? */
export function roomIsLive(room: RoomRow): boolean {
  return room.status === "open" && !isExpired(room);
}

export async function getRoomByCode(code: string): Promise<RoomRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_rooms")
    .select(ROOM_COLUMNS)
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  return (data as RoomRow | null) ?? null;
}

async function closeRoom(roomId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("arena_rooms")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) throw error;
}

/**
 * Saca al jugador de cualquier sala en la que estuviera. Se llama ANTES de
 * crear o entrar a otra: un jugador ocupa una silla a la vez, y así "volver a
 * mi sala" al recargar tiene una única respuesta posible.
 *
 * Si era el anfitrión, la sala que deja se cierra: sin anfitrión no hay quién
 * la arranque, y dejarla abierta solo sirve para que otros esperen de balde.
 */
export async function leaveAllRooms(profileId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_room_players")
    .select("room_id, is_host")
    .eq("profile_id", profileId);
  if (error) throw error;

  const rows = (data ?? []) as { room_id: string; is_host: boolean }[];
  if (rows.length === 0) return;

  const { error: delError } = await db
    .from("arena_room_players")
    .delete()
    .eq("profile_id", profileId);
  if (delError) throw delError;

  for (const row of rows) {
    if (row.is_host) await closeRoom(row.room_id);
    else await closeIfEmpty(row.room_id);
  }
}

/** Una sala sin nadie sentado no es una sala. */
async function closeIfEmpty(roomId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { count, error } = await db
    .from("arena_room_players")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId);
  if (error) throw error;
  if ((count ?? 0) === 0) await closeRoom(roomId);
}

/**
 * Crea la sala y sienta al anfitrión en la silla 0.
 *
 * El código se sortea hasta que uno esté libre. Con 10.000 combinaciones y las
 * salas de un rato, chocar es raro; aun así se reintenta en vez de confiar,
 * porque el que se lleva el choque sería un jugador que no pudo crear su mesa.
 *
 * El anfitrión nace listo: su "listo" es el botón de iniciar, no una casilla
 * aparte que tendría que marcarse a sí mismo.
 */
export async function createRoom(params: {
  profileId: string;
  entryUnits: bigint;
  maxPlayers: number;
  cardsPerPlayer: number;
  /**
   * Sacar al anfitrión de las salas donde estuviera. Solo cuando su identidad
   * está PROBADA: hacerlo por una dirección que alguien dice tener permitiría
   * echar a otro de su partida creando una sala a su nombre.
   */
  leaveOthers?: boolean;
}): Promise<RoomResult<RoomRow>> {
  const db = getSupabaseAdmin();

  // Última barrera antes de escribir. La ruta ya rechazó lo que no cuadraba,
  // pero una sala con un reparto imposible no se puede jugar y tampoco se
  // puede arreglar después: mejor no crearla.
  if (!isDealValid(params.cardsPerPlayer, params.maxPlayers)) {
    return fail("invalid_setup");
  }

  if (params.leaveOthers !== false) await leaveAllRooms(params.profileId);

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await db
      .from("arena_rooms")
      .insert({
        code,
        host_profile_id: params.profileId,
        entry_units: params.entryUnits.toString(),
        max_players: params.maxPlayers,
        cards_per_player: params.cardsPerPlayer,
        // Derivada, no decisiva: la columna vieja sigue describiendo la sala
        // para quien la lea, pero repartir se reparte por la cifra.
        deck_mode: deckModeFor(params.cardsPerPlayer, params.maxPlayers),
      })
      .select(ROOM_COLUMNS)
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue; // código ocupado, otro
      throw error;
    }

    const room = data as RoomRow;

    /**
     * El anfitrión NO se sienta al crear la mesa cuando hay entrada.
     *
     * No es una restricción, es el orden real de los hechos: hasta que la sala
     * no existe no hay código, sin código no hay mesa en el contrato, y sin
     * mesa no se puede pagar. Sentarlo aquí sería darle una silla gratis a
     * quien monta la partida mientras a los demás se les cobra.
     *
     * Con escrow su camino es el mismo que el de todos: ve el código, paga
     * `join`, y `/api/arena/rooms/[code]/paid` lo sienta contra la cadena.
     */
    if (!escrowConfigured()) {
      const { error: seatError } = await db.from("arena_room_players").insert({
        room_id: room.id,
        profile_id: params.profileId,
        seat: 0,
        is_host: true,
        is_ready: true,
      });
      if (seatError) throw seatError;
    } else {
      // La mesa del contrato queda anotada al crear la sala: es el dato que
      // el cliente necesita para pagar y el que cruza la sala con la cadena.
      const { error: tableError } = await db
        .from("arena_rooms")
        .update({
          table_id: tableIdFor(
            room.code,
            params.entryUnits,
            params.maxPlayers
          ).toLowerCase(),
        })
        .eq("id", room.id);
      if (tableError) throw tableError;
    }

    return { ok: true, value: room };
  }

  return fail("server_error");
}

/**
 * Sienta al jugador en una sala por código.
 *
 * La carrera por el último asiento la arbitra el índice único `(room_id, seat)`:
 * dos peticiones simultáneas calculan la misma silla libre, una entra y la otra
 * choca, reintenta con la foto nueva y ahí sí ve la mesa llena. Contar antes de
 * insertar no bastaría — entre el conteo y el insert cabe el otro jugador.
 *
 * Volver a entrar a la sala en la que ya estás no es un error: es lo que pasa
 * al recargar, y devuelve la misma silla.
 */
export async function joinRoom(params: {
  profileId: string;
  code: string;
}): Promise<RoomResult<RoomRow>> {
  const db = getSupabaseAdmin();
  const room = await getRoomByCode(params.code);
  if (!room) return fail("room_not_found");
  if (!roomIsLive(room)) return fail("room_closed");

  for (let attempt = 0; attempt < 6; attempt++) {
    const players = await pruneAndListPlayers(room);

    const mine = players.find((p) => p.profile_id === params.profileId);
    if (mine) return { ok: true, value: room };

    // Pudo cerrarse al caerse el anfitrión durante la limpieza.
    const fresh = await getRoomByCode(params.code);
    if (!fresh || !roomIsLive(fresh)) return fail("room_closed");
    if (players.length >= room.max_players) return fail("room_full");

    const taken = new Set(players.map((p) => p.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;

    await leaveAllRooms(params.profileId);

    const { error } = await db.from("arena_room_players").insert({
      room_id: room.id,
      profile_id: params.profileId,
      seat,
      is_host: false,
      is_ready: false,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue; // le ganaron la silla
      throw error;
    }
    return { ok: true, value: room };
  }

  return fail("room_full");
}

/**
 * Los jugadores de la sala, después de soltar a los que ya no están.
 *
 * Nadie avisa al cerrar la pestaña, así que la ausencia se mide por el latido.
 * Pasado `PLAYER_DROP_MS` la silla se libera para que la mesa pueda llenarse
 * con gente de verdad; si el que se fue era el anfitrión, la sala se cierra.
 */
async function pruneAndListPlayers(room: RoomRow): Promise<PlayerRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_room_players")
    .select(PLAYER_COLUMNS)
    .eq("room_id", room.id)
    .order("seat", { ascending: true });
  if (error) throw error;

  const players = (data ?? []) as unknown as PlayerRow[];
  const cutoff = Date.now() - PLAYER_DROP_MS;
  const gone = players.filter(
    (p) => new Date(p.last_seen_at).getTime() < cutoff
  );
  if (gone.length === 0) return players;

  const { error: delError } = await db
    .from("arena_room_players")
    .delete()
    .eq("room_id", room.id)
    .in(
      "profile_id",
      gone.map((p) => p.profile_id)
    );
  if (delError) throw delError;

  const left = players.filter((p) => !gone.includes(p));
  if (gone.some((p) => p.is_host) || left.length === 0) {
    await closeRoom(room.id);
  }
  return left;
}

/** Marca que este jugador sigue mirando la sala. */
async function touchPlayer(roomId: string, profileId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("arena_room_players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("profile_id", profileId);
  if (error) throw error;
}

function toPlayerView(row: PlayerRow, viewerId: string | null): RoomPlayerView {
  // Sin alias todavía, la wallet abreviada sirve de nombre. Si tampoco hay,
  // queda vacío a propósito: el nombre de reserva es una frase traducible y
  // eso lo pone la pantalla, no el servidor.
  const name = row.profiles?.alias ?? shortWallet(row.profiles?.wallet_address);
  return {
    profileId: row.profile_id,
    name,
    initial: initialOf(name),
    seat: row.seat,
    isHost: row.is_host,
    isReady: row.is_ready,
    online: Date.now() - new Date(row.last_seen_at).getTime() < PLAYER_STALE_MS,
    isYou: row.profile_id === viewerId,
  };
}

/**
 * La foto de la sala tal como la va a pintar la pantalla.
 *
 * `touch = true` aprovecha la lectura como latido: el cliente pregunta por la
 * sala cada pocos segundos de todos modos, así que pedirle además un POST solo
 * para decir "sigo aquí" sería el doble de peticiones por el mismo dato. Es un
 * efecto en un GET, sí, y por eso está dicho aquí y en la ruta.
 */
export async function readRoom(params: {
  code: string;
  viewerProfileId: string | null;
  touch?: boolean;
}): Promise<RoomResult<RoomView>> {
  const room = await getRoomByCode(params.code);
  if (!room) return fail("room_not_found");

  const players = await pruneAndListPlayers(room);
  const viewerId = params.viewerProfileId;
  const isMember = players.some((p) => p.profile_id === viewerId);

  if (params.touch && viewerId && isMember) {
    await touchPlayer(room.id, viewerId);
  }

  // La limpieza pudo cerrarla hace un instante: se relee el estado, no se
  // asume el de antes.
  const after = await getRoomByCode(params.code);
  const live = after ? roomIsLive(after) : false;

  // La consulta va aquí suelta y no llamando a `lib/supabase/arena-matches`
  // para no cerrar un círculo de imports: la partida ya depende de la sala.
  const db = getSupabaseAdmin();
  const { count, error: matchError } = await db
    .from("arena_matches")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id);
  if (matchError) throw matchError;

  const views = players.map((p) => toPlayerView(p, viewerId));
  return {
    ok: true,
    value: {
      code: room.code,
      status: live ? "open" : "closed",
      entryUnits: String(room.entry_units),
      maxPlayers: room.max_players,
      cardsPerPlayer: room.cards_per_player,
      players: views,
      you: views.find((p) => p.isYou) ?? null,
      matchStarted: (count ?? 0) > 0,
    tableId: room.table_id ?? null,
    },
  };
}

/** Marca (o desmarca) a un jugador como listo. */
export async function setReady(params: {
  code: string;
  profileId: string;
  ready: boolean;
}): Promise<RoomResult<RoomView>> {
  const db = getSupabaseAdmin();
  const room = await getRoomByCode(params.code);
  if (!room) return fail("room_not_found");
  if (!roomIsLive(room)) return fail("room_closed");

  const { data, error } = await db
    .from("arena_room_players")
    .update({ is_ready: params.ready, last_seen_at: new Date().toISOString() })
    .eq("room_id", room.id)
    .eq("profile_id", params.profileId)
    .select("profile_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail("not_in_room");

  return readRoom({ code: params.code, viewerProfileId: params.profileId });
}

/**
 * El jugador se levanta de la mesa. Si era el anfitrión, la sala se cierra para
 * todos: es la respuesta honesta a "el anfitrión se fue", mejor que dejar a
 * tres personas esperando un botón que ya nadie puede tocar.
 */
export async function leaveRoom(params: {
  code: string;
  profileId: string;
}): Promise<RoomResult<{ closed: boolean }>> {
  const db = getSupabaseAdmin();
  const room = await getRoomByCode(params.code);
  if (!room) return fail("room_not_found");

  const { data, error } = await db
    .from("arena_room_players")
    .delete()
    .eq("room_id", room.id)
    .eq("profile_id", params.profileId)
    .select("is_host")
    .maybeSingle();
  if (error) throw error;

  const wasHost = (data as { is_host: boolean } | null)?.is_host ?? false;
  if (wasHost) {
    await closeRoom(room.id);
    return { ok: true, value: { closed: true } };
  }
  await closeIfEmpty(room.id);
  return { ok: true, value: { closed: false } };
}

/**
 * La sala en la que este jugador sigue sentado, si hay alguna. Es lo que
 * permite devolverlo a su mesa después de recargar o de irse a otra pantalla.
 */
export async function findActiveRoom(profileId: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_room_players")
    .select("arena_rooms(code, status, created_at)")
    .eq("profile_id", profileId);
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    arena_rooms: { code: string; status: RoomStatus; created_at: string } | null;
  }[];

  for (const row of rows) {
    const room = row.arena_rooms;
    if (!room || room.status !== "open") continue;
    if (Date.now() - new Date(room.created_at).getTime() > ROOM_TTL_MS) continue;
    return room.code;
  }
  return null;
}
