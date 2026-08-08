/**
 * Cuándo se puede repartir, y qué hacer con una mesa pagada que nunca arrancó.
 *
 * Funciones puras, sin red ni base, por lo mismo que `arena-outcome.ts`: esto
 * decide sobre entradas ya cobradas y tiene que poder recorrerse entero desde
 * `scripts/verify-arena-start-guard.ts`.
 *
 * ── Por qué existe este archivo ────────────────────────────────────────────
 *
 * El botón "Iniciar partida" se deshabilita en la pantalla cuando falta gente.
 * Eso es una cortesía, no una regla: una petición armada a mano contra la API
 * no ve botones. La regla vive aquí y la aplica el servidor.
 *
 * Y la comprobación de que están PAGADOS es nueva. Antes se miraban las filas
 * de nuestra base —cuántos hay sentados y si dijeron que sí— y eso responde a
 * "cuánta gente hay", no a "cuánta gente puso dinero". Las dos preguntas se
 * contestaban igual solo mientras nada pudiera crear una silla sin pago; con
 * escrow, la silla la crea la cadena y es a la cadena a quien hay que
 * preguntarle.
 */

/** Por qué no se reparte. Códigos, no frases: el idioma lo pone la pantalla. */
export type StartRefusal =
  | "not_host"
  | "room_closed"
  /** Faltan sillas por ocupar. */
  | "room_not_full"
  /** Alguien sentado no aparece como pagador en la cadena. */
  | "seats_not_paid"
  /** Están todos y pagaron, pero alguno no ha confirmado. */
  | "players_not_ready";

export interface StartSeat {
  ready: boolean;
  /** Dirección que pagó esta silla. `null` en las mesas gratis. */
  walletAddress: string | null;
}

export interface StartCheck {
  isHost: boolean;
  /** La sala sigue abierta y no ha vencido. */
  roomLive: boolean;
  /** Sillas que la sala configuró. Es el número que hay que llenar. */
  maxPlayers: number;
  seated: readonly StartSeat[];
  /**
   * Direcciones que la CADENA dice que pagaron esta mesa, en minúsculas.
   * `null` cuando la sala es gratis y no hay nada que comprobar.
   */
  onchainPlayers: readonly string[] | null;
}

const norm = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

/**
 * ¿Se puede repartir?
 *
 * El orden de los rechazos es el orden en que hay que resolverlos, y el del
 * dinero va antes que el de la voluntad: un "estoy listo" sobre una silla que
 * no consta pagada no significa nada, así que preguntar por él primero sería
 * contestar la pregunta equivocada.
 */
export function decideMatchStart(
  check: StartCheck
): { ok: true } | { ok: false; error: StartRefusal } {
  if (!check.isHost) return { ok: false, error: "not_host" };
  if (!check.roomLive) return { ok: false, error: "room_closed" };

  /*
   * La mesa tiene que estar EXACTAMENTE llena.
   *
   * Aquí es donde se protege la entrada de quien se quedó solo: sin este
   * rechazo, repartir con 1 de 2 crearía una partida de un jugador que ese
   * jugador ganaría sin jugar, y el contrato liquidaría su propia entrada
   * cobrándole la comisión. Se compara con `!==` y no con `<`: una mesa con
   * más gente que sillas es un fallo nuestro, y repartir sobre él sería
   * repartir un mazo que no cuadra.
   */
  if (check.seated.length !== check.maxPlayers) {
    return { ok: false, error: "room_not_full" };
  }

  // Mesa con entrada: la silla la da la cadena, no nuestra fila. Se exige que
  // TODOS los sentados aparezcan como pagadores, no solo que la cuenta cuadre:
  // dos filas apuntando a la misma dirección sumarían dos y serían una.
  if (check.onchainPlayers !== null) {
    const pagadores = new Set(check.onchainPlayers.map(norm));
    if (pagadores.size < check.maxPlayers) {
      return { ok: false, error: "seats_not_paid" };
    }
    const todosPagaron = check.seated.every((s) => {
      const address = norm(s.walletAddress);
      return address !== "" && pagadores.has(address);
    });
    if (!todosPagaron) return { ok: false, error: "seats_not_paid" };
  }

  if (!check.seated.every((s) => s.ready)) {
    return { ok: false, error: "players_not_ready" };
  }

  return { ok: true };
}

/**
 * ¿Se le puede quitar la silla a alguien que dejó de aparecer?
 *
 * En una mesa gratis, sí y hay que hacerlo: nadie avisa al cerrar la pestaña y
 * una mesa llena de fantasmas no arranca nunca.
 *
 * En una mesa PAGADA, jamás. Esa fila no es "quién está mirando la pantalla":
 * es el registro de que esa dirección puso dinero en esta mesa, y es de donde
 * sale la dirección a la que hay que devolvérselo o pagarle el premio.
 * Borrarla porque el teléfono se bloqueó un minuto convertía una entrada pagada
 * en un dólar sin dueño dentro del contrato — y encima cerraba la sala, así que
 * el jugador se quedaba sin siquiera un sitio al que volver.
 *
 * Ausentarse sigue teniendo consecuencia en una mesa pagada; la que le
 * corresponde, que es perder la partida por abandono una vez empezada
 * (`arena-outcome.ts`), no perder la silla antes de empezarla.
 */
export function seatIsDroppable(
  seat: { paidAt: string | null; lastSeenAt: string },
  dropAfterMs: number,
  now: number
): boolean {
  if (seat.paidAt) return false;
  return now - new Date(seat.lastSeenAt).getTime() > dropAfterMs;
}

/** Qué hacer con una mesa pagada que sigue abierta en el contrato. */
export type StaleTableVerdict =
  /** Anular y devolver: nunca se llenó y ya no va a llenarse. */
  | "refund"
  /** Todavía podría llenarse. No se toca. */
  | "wait"
  /** No es asunto de esta barrida. */
  | "skip";

export interface StaleTable {
  /** Llegó a repartirse. Entonces manda la liquidación, no la devolución. */
  hasMatch: boolean;
  /** La sala ya está cerrada en nuestra base. */
  roomClosed: boolean;
  /** Cuánto lleva viva la sala. */
  ageMs: number;
  /** Ya se le devolvió a alguien: no se anula dos veces. */
  alreadyRefunded: boolean;
  /** A partir de cuándo una sala abierta se da por muerta. */
  ttlMs: number;
}

/**
 * La regla que faltaba: **una mesa que nunca llegó a empezar se anula y se
 * devuelve íntegra**, nunca se trata como partida jugada ni como abandono.
 *
 * El contrato ya lo permitía —`voidTable` + `refund`, y hasta `voidByTimeout`
 * para que nadie dependa de nosotros—, pero nada en la aplicación lo empujaba:
 * una sala que se cerraba sin llenarse simplemente dejaba de existir para
 * nosotros con el dinero dentro del escrow. Recuperarlo exigía que el jugador
 * supiera llamar a un contrato, que es lo mismo que no poder.
 */
export function decideStaleTable(t: StaleTable): StaleTableVerdict {
  // Hubo partida: el dinero lo mueve la liquidación, y anular por detrás sería
  // quitarle el premio a quien lo ganó.
  if (t.hasMatch) return "skip";
  if (t.alreadyRefunded) return "skip";
  if (t.roomClosed || t.ageMs > t.ttlMs) return "refund";
  return "wait";
}
