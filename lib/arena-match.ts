/**
 * La partida de Arena vista desde fuera: los tipos que cruzan el cable y las
 * pocas reglas que el navegador y el servidor tienen que leer igual.
 *
 * Aquí no se decide nada del juego. Quién acertó, quién se quedó sin cartas y
 * en qué orden pasaron las cosas lo dice el servidor; esto solo le da forma a
 * la respuesta para que la pantalla la pueda pintar.
 */

/**
 * Lo que dura el 3, 2, 1.
 *
 * Son cuatro segundos y medio y no tres por una razón concreta: el invitado
 * nunca tocó "iniciar" y llega a la partida cuando su pantalla se entera de que
 * existe. Con el canal de Realtime eso es inmediato, pero si el canal no está,
 * puede tardar un latido de la sala. El colchón hace que igual alcance a ver la
 * cuenta entera en vez de aparecer con la partida ya empezada.
 */
export const COUNTDOWN_MS = 4_500;

/**
 * Cada cuánto pregunta el cliente por el estado. Mucho más seguido que en la
 * sala: aquí un segundo de retraso en la base compartida se siente como un
 * error del juego. El broadcast de Realtime adelanta la mayoría de los cambios;
 * esto es el suelo por si el canal no está.
 */
export const MATCH_POLL_MS = 1_000;

/** Sin latido durante este rato, al rival se le pinta "Desconectado". */
export const RIVAL_STALE_MS = 8_000;

/**
 * Y a partir de aquí ya no volvió: la partida se cierra y gana el que sigue
 * ahí. Generoso a propósito — perder el ascensor no debería costar la partida.
 */
export const ABANDON_MS = 45_000;

export type MatchPhase = "countdown" | "playing" | "finished";

/** Qué hizo el servidor con tu toque. */
export type MoveOutcome =
  /** Acertaste: tu carta es la nueva base y salió de tu mazo. */
  | "ok"
  /** Fallaste: una carta más al final del mazo. */
  | "penalty"
  /**
   * Llegaste tarde: la base ya había cambiado cuando tu toque aterrizó. No es
   * culpa tuya y no cuesta nada — vuelves a mirar contra la base nueva.
   */
  | "stale"
  /** Todavía corre la cuenta regresiva. */
  | "too_early"
  | "finished"
  | "not_playing"
  | "no_match";

export type MatchError =
  | "no_match"
  | "not_playing"
  | "not_host"
  | "room_not_ready"
  | "invalid_code"
  | "unauthorized"
  | "server_error";

export interface MatchPlayerView {
  profileId: string;
  name: string;
  initial: string;
  seat: number;
  cardsLeft: number;
  correct: number;
  errors: number;
  /** Cartas que le cayeron por fallar. Es lo que duele, no el reloj. */
  penalties: number;
  online: boolean;
  left: boolean;
  finished: boolean;
  isYou: boolean;
}

export interface MatchView {
  code: string;
  phase: MatchPhase;
  /** Versión de la base. Sube con cada carta jugada, por cualquiera. */
  seq: number;
  /** Índice de la carta base. Solo sirve para dibujarla igual siempre. */
  baseCard: number;
  baseSymbols: string[];
  /**
   * Tu carta. El servidor NUNCA manda la del rival: su mano es suya hasta que
   * la juega y se vuelve base. Por eso van los símbolos de estas dos cartas y
   * no la semilla del mazo — con la semilla, un cliente curioso podría deducir
   * el mazo entero.
   */
  myCard: number | null;
  mySymbols: string[] | null;
  /** Cuándo termina la cuenta regresiva (ISO, reloj del servidor). */
  startsAt: string;
  /** El reloj del servidor al responder, para corregir el del teléfono. */
  serverNow: string;
  finishedAt: string | null;
  winnerProfileId: string | null;
  endReason: "cleared" | "abandoned" | null;
  you: MatchPlayerView | null;
  rival: MatchPlayerView | null;
}

/** ¿Ya se puede tocar? */
export function matchPhaseAt(view: {
  startsAt: string;
  finishedAt: string | null;
}, now: number): MatchPhase {
  if (view.finishedAt) return "finished";
  return now < new Date(view.startsAt).getTime() ? "countdown" : "playing";
}

/**
 * Qué número enseña la cuenta regresiva: 3, 2, 1 y luego 0 (que la pantalla
 * dibuja como "¡YA!"). Se calcula del reloj del servidor, no de un temporizador
 * local, para que los dos teléfonos canten el mismo número a la vez.
 */
export function countdownNumber(startsAt: string, now: number): number {
  const left = new Date(startsAt).getTime() - now;
  if (left <= 0) return 0;
  return Math.min(3, Math.ceil(left / 1000));
}

/** Ganó, perdió, o todavía nada. */
export function matchResultFor(
  view: MatchView
): "won" | "lost" | null {
  if (!view.finishedAt || !view.you) return null;
  return view.winnerProfileId === view.you.profileId ? "won" : "lost";
}
