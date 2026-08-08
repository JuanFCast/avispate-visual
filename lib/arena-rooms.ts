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

/**
 * Longitud del código de sala. Es TODO el código: seis caracteres y nada más.
 *
 * ── Por qué ya no hay prefijo ───────────────────────────────────────────────
 *
 * El código llevaba un `AVP-` delante para hacerlo reconocible suelto en un
 * chat. Costaba más de lo que valía: cuatro caracteres de ceremonia en la parte
 * de la pantalla que más se dicta, se teclea y se pega, un decorado fijo dentro
 * del campo de unirse que había que explicar, y un formato con dos maneras de
 * escribirse —con guion y sin él— que cada capa tenía que volver a normalizar.
 * En un teléfono, que es donde se usa esto, `MY37GV` se lee y se dicta mejor
 * que `AVP-MY37GV`, y el contexto ya lo da la pantalla que lo pide.
 *
 * Seis caracteres de este alfabeto son **más de mil millones** de
 * combinaciones. Cabe en un mensaje, se dicta sin deletrear y se teclea de una
 * vez, que es todo lo que un código de sala tiene que hacer.
 */
export const ROOM_CODE_LENGTH = 6;

/**
 * Alfabeto de Crockford: los 10 dígitos y las letras MENOS `I`, `L`, `O` y `U`.
 *
 * Las tres primeras se quitan porque se confunden con `1` y `0` al leerlas en
 * una pantalla pequeña o al dictarlas por teléfono, que es exactamente lo que
 * hace la gente con estos códigos. La `U` se quita para no formar palabras que
 * nadie quiere leer en su pantalla por casualidad.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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
  /** Entrada, jugadores o cartas que no son una combinación real. */
  | "invalid_setup"
  /** Falta la ficha de la silla: se paga y se reclama, no se firma. */
  | "seat_token_required"
  | "seat_token_wrong_table"
  /** La cadena no confirma que esa dirección pagó esta mesa. */
  | "seat_not_paid"
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
  /**
   * Cuántas cartas le tocarán a cada uno. Lo eligió el anfitrión y baja tal
   * cual desde la base: quien se une tiene que poder LEER la cifra antes de
   * sentarse, no deducirla de un modo y un número de jugadores.
   */
  cardsPerPlayer: number;
  /** Ordenados por silla, incluidas las vacías (que simplemente no aparecen). */
  players: RoomPlayerView[];
  /** Null cuando quien mira todavía no se sentó (llegó por el enlace). */
  you: RoomPlayerView | null;
  /**
   * El anfitrión ya repartió. Es lo que arrastra a los DOS a la partida: el
   * invitado nunca tocó "iniciar", así que su pantalla se entera por aquí.
   */
  matchStarted: boolean;
  /**
   * Mesa en el contrato del escrow, o `null` si la sala es gratis. Decide si
   * hay que pagar para sentarse — y lo decide la SALA, no la configuración del
   * servidor: una sala nace gratis o nace paga y no cambia de naturaleza.
   */
  tableId: string | null;
}

/**
 * Un código nuevo. `crypto.getRandomValues` existe igual en el navegador y en
 * Node 18+; el módulo se rechaza para no sesgar hacia los primeros valores.
 */
export function generateRoomCode(): string {
  const buf = new Uint8Array(ROOM_CODE_LENGTH);
  let out = "";
  // Rechazo por módulo: 256 no es múltiplo de 32, así que los bytes altos
  // sesgarían hacia el principio del alfabeto. Con 32 símbolos el corte cae en
  // 256 justo, pero se deja explícito para que cambiar el alfabeto no
  // introduzca el sesgo en silencio.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (out.length < ROOM_CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === ROOM_CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * Lo escrito → solo los símbolos que un código puede llevar, sin recortar.
 *
 * Sube a mayúsculas, traduce las confusiones de siempre —la `O` que era un
 * cero, la `I` o la `ele` que eran un uno— y tira todo lo demás: espacios,
 * guiones y cualquier letra que no esté en el alfabeto. Son letras que no
 * generamos nunca, así que traducirlas no puede chocar con un código real.
 *
 * No recorta a propósito, y de eso depende que `normalizeRoomCode` no mienta:
 * si truncara, pegar nueve caracteres daría los seis primeros como si fueran un
 * código bueno y mandaría al jugador a una sala que no es la suya.
 */
function cleanRoomCode(raw: string): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("");
}

/**
 * Lo que el jugador tecleó → el código canónico, o `null` si no lo es.
 *
 * Acepta lo que la gente escribe de verdad: `MY37GV`, `my37gv`, `  MY 37 GV `.
 * Lo que NO acepta es otra cosa que seis símbolos del alfabeto — ni de más, ni
 * de menos, ni con un prefijo delante.
 */
export function normalizeRoomCode(raw: string): string | null {
  const code = cleanRoomCode(raw);
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

/** ¿Ya viene escrito exactamente como lo guardamos? */
export function isRoomCode(value: string): boolean {
  return normalizeRoomCode(value) === value;
}

/**
 * Formato mientras se escribe: mayúsculas, solo símbolos del alfabeto y sin
 * pasar de la cuenta.
 *
 * Las confusiones se corrigen en el momento de teclearlas: ver cómo tu `O` se
 * convierte en `0` mientras escribes enseña el alfabeto sin que nadie tenga que
 * explicarlo.
 */
export function formatRoomCodeInput(raw: string): string {
  return cleanRoomCode(raw).slice(0, ROOM_CODE_LENGTH);
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

/**
 * Qué puede hacer quien está mirando la sala.
 *
 * Se decide aquí, en una función pura, y no dentro del JSX, porque este reparto
 * ya se equivocó una vez: el botón de "Estoy listo" vivía en la rama del
 * invitado y el anfitrión solo veía el de empezar. Mientras crear la sala te
 * dejaba listo automáticamente eso no se notaba; en cuanto el anfitrión pasó a
 * sentarse pagando como todos, se quedó en "Sin confirmar" sin ninguna forma de
 * confirmar, y la partida no arrancaba nunca.
 *
 * La regla, dicha entera: **todos confirman, incluido quien montó la mesa.**
 * Nadie queda listo por crear la sala ni por pagar — pagar te da la silla, no
 * la voluntad de empezar.
 */
export interface RoomActions {
  /** Puede pulsar "Estoy listo" (o quitarlo). Todos los sentados. */
  canReady: boolean;
  /** Puede repartir. Solo el anfitrión, y solo con todos listos. */
  canStart: boolean;
  /** Está listo y espera a que el anfitrión reparta. */
  waitingForHost: boolean;
}

export function roomActionsFor(room: RoomView): RoomActions {
  const you = room.you;
  if (!you) return { canReady: false, canStart: false, waitingForHost: false };

  const todosListos = roomCanStart(room);
  return {
    // Confirmar es siempre suyo: es un estado, no un permiso.
    canReady: room.status === "open",
    canStart: you.isHost && todosListos,
    waitingForHost: !you.isHost && todosListos,
  };
}

/** Nombre del canal de Realtime de una sala. Mismo en los dos lados. */
export function roomChannelName(code: string): string {
  return `arena-room:${code}`;
}

