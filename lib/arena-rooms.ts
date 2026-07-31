/**
 * Salas privadas de la Arena: el código, la forma del estado y las reglas que
 * el navegador y el servidor tienen que leer IGUAL.
 *
 * Todo lo de aquí es puro. Quién puede entrar, cuándo se puede arrancar y quién
 * está desconectado se decide con las mismas funciones en los dos lados: la
 * pantalla las usa para pintar y el servidor para no dejarse engañar. Nada de
 * dinero se mueve en esta fase — `entryUnits` es lo acordado en el lobby, y el
 * pozo que se muestra sigue siendo el estimado de `lib/arena`.
 */

/** El prefijo que hace reconocible al código incluso suelto en un chat. */
export const ROOM_CODE_PREFIX = "AVP";
/** Cuatro dígitos: se dicta por teléfono y se teclea sin equivocarse. */
export const ROOM_CODE_DIGITS = 4;

const CODE_RE = /^AVP-\d{4}$/;

/**
 * Cada cuánto late el cliente contra el servidor. Es a la vez el latido de
 * "sigo aquí" y la red de seguridad si Realtime no está disponible.
 */
export const ROOM_HEARTBEAT_MS = 4_000;

/**
 * Sin latido durante este rato, el jugador aparece como desconectado. Son tres
 * latidos perdidos: un semáforo en rojo del metro no debería sacarte de la sala.
 */
export const PLAYER_STALE_MS = 15_000;

/**
 * Sin latido durante este otro rato, ya no está desconectado: se fue. La silla
 * se libera y la sala vuelve a admitir gente, porque nadie avisa al cerrar la
 * pestaña y una mesa llena de fantasmas no arranca nunca. Es cuatro veces
 * `PLAYER_STALE_MS`: da tiempo de sobra a volver de un túnel.
 */
export const PLAYER_DROP_MS = 60_000;

/**
 * Una sala abierta más vieja que esto se trata como cerrada. Nadie sigue
 * esperando en una mesa de hace dos horas, y el código vuelve a estar libre.
 */
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

export type RoomStatus = "open" | "closed";

/**
 * Por qué no se pudo. Es un CÓDIGO y no una frase: el servidor no sabe en qué
 * idioma está mirando el jugador, así que la pantalla lo traduce.
 */
export type RoomError =
  | "invalid_code"
  | "room_not_found"
  | "room_closed"
  | "room_full"
  | "not_in_room"
  | "not_host"
  | "unauthorized"
  | "server_error";

export interface RoomPlayerView {
  profileId: string;
  /** Alias, o wallet abreviada si todavía no eligió alias. */
  name: string;
  /** Primera letra para el avatar redondo. */
  initial: string;
  seat: number;
  isHost: boolean;
  isReady: boolean;
  /** Latió hace poco. Falso = cerró la pestaña o se quedó sin señal. */
  online: boolean;
  /** Es quien está mirando la pantalla. */
  isYou: boolean;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  /** Unidades de USDT como texto: el JSON no sabe de `bigint`. */
  entryUnits: string;
  maxPlayers: number;
  /** Ordenados por silla, incluidas las vacías (que simplemente no aparecen). */
  players: RoomPlayerView[];
  /** Null cuando quien mira todavía no se sentó (llegó por el enlace). */
  you: RoomPlayerView | null;
}

/**
 * Un código nuevo. `crypto.getRandomValues` existe igual en el navegador y en
 * Node 18+; el módulo se rechaza para no sesgar hacia los primeros valores.
 */
export function generateRoomCode(): string {
  const max = 10 ** ROOM_CODE_DIGITS;
  const limit = Math.floor(65_536 / max) * max;
  const buf = new Uint16Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return `${ROOM_CODE_PREFIX}-${String(n % max).padStart(ROOM_CODE_DIGITS, "0")}`;
}

/**
 * Lo que el jugador tecleó → un código canónico, o `null` si no lo es.
 *
 * Acepta lo que la gente escribe de verdad: `4821`, `avp4821`, `AVP 4821`,
 * `avp-4821`. Escribir bien el guion no debería ser parte del juego.
 */
export function normalizeRoomCode(raw: string): string | null {
  const clean = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digits = clean.startsWith(ROOM_CODE_PREFIX)
    ? clean.slice(ROOM_CODE_PREFIX.length)
    : clean;
  if (!new RegExp(`^\\d{${ROOM_CODE_DIGITS}}$`).test(digits)) return null;
  return `${ROOM_CODE_PREFIX}-${digits}`;
}

/** ¿Es un código con la forma correcta? */
export function isRoomCode(value: string): boolean {
  return CODE_RE.test(value);
}

/**
 * Formato mientras se escribe: mayúsculas, el prefijo puesto por nosotros y el
 * guion donde va. El jugador solo aporta dígitos.
 */
export function formatRoomCodeInput(raw: string): string {
  const digits = (raw ?? "")
    .toUpperCase()
    .replace(/[^0-9]/g, "")
    .slice(0, ROOM_CODE_DIGITS);
  if (!digits) return "";
  return `${ROOM_CODE_PREFIX}-${digits}`;
}

/** Inicial para el avatar. Vacío o raro → la abeja. */
export function initialOf(name: string): string {
  const first = (name ?? "").trim()[0];
  return first ? first.toUpperCase() : "🐝";
}

/** `0xabc…1234`: la wallet como nombre de reserva mientras no haya alias. */
export function shortWallet(address: string | null | undefined): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** La mesa está completa. */
export function roomIsFull(room: Pick<RoomView, "players" | "maxPlayers">): boolean {
  return room.players.length >= room.maxPlayers;
}

/**
 * Se puede arrancar: la mesa llena y todos listos. Ojo — esto NO inicia nada
 * todavía; solo decide si el botón del anfitrión se puede tocar.
 */
export function roomCanStart(room: RoomView): boolean {
  return (
    room.status === "open" &&
    roomIsFull(room) &&
    room.players.every((p) => p.isReady)
  );
}

/** Nombre del canal de Realtime de una sala. Mismo en los dos lados. */
export function roomChannelName(code: string): string {
  return `arena-room:${code}`;
}
