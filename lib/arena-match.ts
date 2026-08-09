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

/**
 * Cada cuánto pregunta la pantalla de resultados mientras espera el premio.
 *
 * Terminada la partida no hay nada que refrescar salvo una cosa: si el pago del
 * ganador ya salió a la cadena. Un segundo sería absurdo para eso; seis dan la
 * confirmación en la misma pantalla, sin que nadie tenga que recargar para
 * saber si le pagaron.
 */
export const SETTLED_POLL_MS = 6_000;

/**
 * Y no para siempre. Pasado este rato desde el final, la pantalla deja de
 * preguntar: si la liquidación no salió en cinco minutos, no va a salir por
 * insistir —la retoma el cron— y el ganador tiene el premio en su perfil.
 */
export const SETTLE_WATCH_MS = 5 * 60_000;

/** Sin latido durante este rato, al rival se le pinta "Desconectado". */
export const RIVAL_STALE_MS = 8_000;

/**
 * Y a partir de aquí ya no volvió: la partida se cierra y gana el que sigue
 * ahí. Generoso a propósito — perder el ascensor no debería costar la partida.
 */
export const ABANDON_MS = 45_000;

/**
 * El mismo margen, pero en una mesa con ENTRADA. Es más largo a propósito.
 *
 * Sin dinero, que un túnel te cueste la partida es un fastidio; con dinero te
 * cuesta la entrada, y noventa segundos siguen sin dejar al rival esperando de
 * más. El número lo eligió Juan el 2026-08-07 sabiendo que el de gratis son 45.
 */
export const PAID_ABANDON_MS = 90_000;

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
  /** El reparto configurado no cuadra con el plano de cartas. */
  | "room_not_ready"
  /**
   * Los tres motivos por los que no se reparte, separados a propósito.
   *
   * Iban todos como `room_not_ready` y la pantalla decía "la sala no está
   * lista", que es cierto y no sirve: quien está solo esperando y quien tiene
   * la mesa llena con alguien sin confirmar necesitan hacer cosas distintas.
   * Y `seats_not_paid` no es un aviso de forma sino de dinero — significa que
   * hay una silla ocupada que la cadena no reconoce.
   */
  | "room_not_full"
  | "players_not_ready"
  | "seats_not_paid"
  | "room_closed"
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
  /**
   * Duelos GANADOS: veces que este jugador se llevó una carta que otro estaba
   * reclamando en ese mismo instante.
   *
   * No es "cuántas cartas tomó" — eso es `correct`, y sube igual en una partida
   * donde nadie compite. Un duelo exige que hubiera otro yendo a por la misma
   * jugada y que el servidor resolviera a favor de este. Quién ganó lo decide
   * el cerrojo de `arena_apply_move`, con el reloj del servidor; el navegador no
   * manda ningún tiempo y no participa en la cuenta.
   */
  duelsWon: number;
  errors: number;
  /** Cartas que le cayeron por fallar. Es lo que duele, no el reloj. */
  penalties: number;
  online: boolean;
  left: boolean;
  finished: boolean;
  isYou: boolean;
}

/**
 * Cuánto había en juego en esta mesa, y qué pasó con el dinero.
 *
 * Viaja con la partida —y no se recalcula en el navegador— porque la pantalla
 * de resultados tiene que poder decir una cifra exacta: "ganaste 0.16 USDT" es
 * una promesa, y una promesa la hace el servidor o no la hace nadie.
 *
 * En una mesa gratis `paid` es `false` y las cifras van en cero: la pantalla lo
 * dice con todas las letras en vez de enseñar un premio de 0.00.
 */
export interface MatchStakes {
  /** Lo que costó la silla, en unidades de USDT. "0" en las mesas gratis. */
  entryUnits: string;
  /**
   * Lo que se lleva quien gana, ya descontada la comisión. Va calculado y no
   * en piezas (entrada × sillas − comisión) para que la pantalla no pueda
   * llegar a un número distinto del que se paga.
   */
  prizeUnits: string;
  /** `true` solo si la mesa cobra de verdad: tiene mesa en el contrato. */
  paid: boolean;
  /**
   * La mesa en el contrato, o `null` en una gratis.
   *
   * La pantalla de partida lo necesita para una cosa concreta: el secreto de la
   * silla se guarda POR MESA, y sin este dato no habría forma de encontrarlo
   * para pedir una ficha nueva cuando la vieja vence a mitad de partida
   * (`arena-seat-recovery.ts`). No revela nada: se deriva de datos que ya son
   * públicos —código, entrada y sillas— y la sala ya lo manda.
   */
  tableId: string | null;
  /**
   * El pago del premio. `null` mientras no se haya reclamado; con `txHash` en
   * `null`, reclamado pero todavía sin confirmar en la cadena. Los dos primeros
   * estados se le cuentan igual al ganador —"va en camino"—, pero se distinguen
   * aquí porque significan cosas distintas para quien tenga que ir a mirar.
   */
  payout: { txHash: string | null } | null;
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
  /** Cuántas cartas recibió cada uno al repartir. La misma cifra para todos. */
  cardsPerPlayer: number;
  /** La apuesta de la mesa y el destino del premio. */
  stakes: MatchStakes;
  you: MatchPlayerView | null;
  /** Los demás, en orden de silla. Pueden ser uno, dos o tres. */
  rivals: MatchPlayerView[];
}

/**
 * Las clases del contenedor de la partida, según en qué va.
 *
 * ── Por qué esto es una función y no una cadena escrita en la página ────────
 *
 * `playing` es un CANDADO: fija el alto a `100dvh` y esconde el desbordamiento
 * para que el tablero quepa entero en una pantalla, sin scroll que estorbe a
 * mitad de una carrera. Mientras se juega es lo correcto.
 *
 * La página la ponía como texto fijo, así que el candado seguía puesto al
 * terminar: la pantalla de resultados quedaba recortada al alto del viewport y
 * no había forma de bajar hasta "Otra sala". En un navegador de escritorio no
 * se notaba —cabía— y en un teléfono dentro de MiniPay, con la barra del
 * WebView comiéndose alto, no cabía. Le pasó al que perdió y no al que ganó,
 * porque el perdedor tiene una línea más ("Quedaste 2º de 3").
 *
 * Ahora el candado depende de la fase, y depende de ella AQUÍ, en una función
 * pura que `scripts/verify-match-over-scroll.ts` puede interrogar. Si alguien
 * vuelve a fijarlo, la verificación falla antes que el jugador.
 */
export function matchShellClass(phase: MatchPhase | null): string {
  const locked = phase === "countdown" || phase === "playing";
  return `shell match-shell ${locked ? "playing" : "match-shell-done"}`;
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

/**
 * Cada cuánto volver a preguntar por la partida, o `null` para dejar de hacerlo.
 *
 * Tres ritmos y no uno: jugando, cada segundo, porque un retraso en la base
 * compartida se siente como un juego roto. Terminada y con premio pendiente,
 * cada seis, solo para poder decir "pagado" sin recargar. Terminada y sin nada
 * que esperar, nunca — un latido contra una partida que ya no cambia es gasto
 * de batería y de servidor.
 */
export function matchPollMs(
  view: MatchView | null,
  error: MatchError | null,
  now: number
): number | null {
  // La partida no existe: preguntar otra vez daría el mismo 404.
  if (error === "no_match") return null;
  if (!view || view.phase !== "finished") return MATCH_POLL_MS;

  const settled = view.stakes.payout?.txHash;
  if (!view.stakes.paid || settled) return null;

  const since = view.finishedAt ? now - new Date(view.finishedAt).getTime() : 0;
  return since < SETTLE_WATCH_MS ? SETTLED_POLL_MS : null;
}

/** Ganó, perdió, o todavía nada. */
export function matchResultFor(
  view: MatchView
): "won" | "lost" | null {
  if (!view.finishedAt || !view.you) return null;
  return view.winnerProfileId === view.you.profileId ? "won" : "lost";
}

/**
 * La tabla final, en orden de puesto.
 *
 * La partida termina para todos en cuanto el primero vacía su mazo, así que a
 * los demás hay que ordenarlos por lo que sí se puede comparar: cuántas cartas
 * les quedaban en ese instante. No es un podio jugado —nadie más llegó a cero—
 * pero es honesto y contesta la única pregunta que queda en una mesa de cuatro:
 * de los que perdimos, ¿quién iba mejor?
 *
 * El ganador va primero pase lo que pase. Con final por abandono puede tener
 * MÁS cartas que los otros, y aun así ganó: coronarlo tercero en su propia
 * tabla sería contar otra partida.
 */
export function standingsOf(view: MatchView): MatchPlayerView[] {
  const all = view.you ? [view.you, ...view.rivals] : [...view.rivals];
  return all.sort((a, b) => {
    if (a.profileId === view.winnerProfileId) return -1;
    if (b.profileId === view.winnerProfileId) return 1;
    if (a.cardsLeft !== b.cardsLeft) return a.cardsLeft - b.cardsLeft;
    if (a.penalties !== b.penalties) return a.penalties - b.penalties;
    return a.seat - b.seat;
  });
}
