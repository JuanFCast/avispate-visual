/**
 * Quién puede ocupar una silla de la Arena y actuar desde ella.
 *
 * Función pura, sin red ni React, por lo mismo que `pay-guard.ts`: esto decide
 * sobre dinero de otras personas y tiene que poder correrse entero desde
 * `scripts/verify-arena-seat.ts`.
 *
 * ── La regla, acordada el 2026-08-04 antes de escribir el escrow ──────────
 *
 * **Una sesión abierta con un `txHash` no puede autorizar ninguna acción que
 * afecte dinero.** No es una preferencia: es la condición bajo la que se
 * aceptaron esas sesiones. Su modelo de amenaza está escrito en
 * `lib/wallet-session.ts` y dice, con todas las letras, que un hash es público
 * en cuanto se mina y que alguien podría canjear el ajeno dentro de la ventana
 * de cinco minutos. Se asumió **porque el daño máximo era vandalismo**: cambiar
 * un alias, estropear una sala. Nadie perdía plata.
 *
 * En una mesa con entrada, ese mismo robo deja de ser vandalismo. Quien entre
 * con la sesión ajena juega desde la silla que pagó la víctima, y jugar mal a
 * propósito es hacerle perder el pozo. La justificación entera se cae.
 *
 * ── La salida: la ficha de silla, no el tipo de sesión ────────────────────
 *
 * La primera versión de esto miraba QUÉ sesión traías y rechazaba las de
 * MiniPay en mesas con entrada. Era seguro y dejaba a MiniPay fuera del
 * producto con dinero, que no es aceptable.
 *
 * Ahora no se mira la sesión: se mira si traes la **ficha de la silla**. Esa
 * ficha solo se consigue enseñando el secreto que el jugador guardó en su
 * dispositivo ANTES de pagar, y cuya huella quedó dentro de la transacción
 * (`seat-secret.ts`, `seat-token.ts`, `/api/arena/seat`). Un mirón de la cadena
 * ve la huella y no puede darle la vuelta, así que no puede conseguir la ficha
 * por mucho que le robe la sesión a alguien.
 *
 * Con eso la regla se cumple mejor que antes y en las dos plataformas: quien
 * autoriza la acción de dinero ya no es la sesión —da igual de qué tipo sea—
 * sino la prueba de la silla. Web y MiniPay comparten un solo modelo.
 *
 * ── Y la silla la da la cadena ────────────────────────────────────────────
 *
 * La ficha dice "probé el secreto de esta silla"; la cadena dice quién pagó. Se
 * exigen las dos: sin la lista de pagadores no hay silla, y sin ficha no hay
 * permiso para usarla. La lista viene del contrato, nunca de una fila creada
 * por una sesión.
 */

/** Qué se quiere hacer con la silla. */
export type SeatAction =
  /** Sentarse en una mesa. */
  | "join"
  /** Decir "listo", empezar la partida, mover, o levantarse. */
  | "act";

export type SeatVerdict =
  | { ok: true }
  /** La mesa cobra entrada y no se trajo ficha de silla. */
  | { ok: false; error: "seat_token_required" }
  /** La ficha es de OTRA mesa. Una silla no se presta entre mesas. */
  | { ok: false; error: "seat_token_wrong_table" }
  /** Esa dirección no pagó esta mesa: la cadena no la conoce. */
  | { ok: false; error: "seat_not_paid" };

export interface SeatCheck {
  /**
   * La mesa tiene escrow en el contrato. Mientras sea `false` la Arena se
   * comporta como hasta hoy — que es lo que permite desplegar este cambio antes
   * que el contrato sin romperle la partida a nadie.
   */
  escrowed: boolean;
  /** La mesa sobre la que se quiere actuar. */
  tableId: string;
  /** Lo que dice la ficha traída, ya verificada su firma. `null` si no vino. */
  seat: { tableId: string; address: string } | null;
  /** Direcciones que pagaron esta mesa, leídas del contrato. En minúsculas. */
  onchainPlayers: readonly string[];
  action: SeatAction;
}

const norm = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

export function decideSeatAccess(check: SeatCheck): SeatVerdict {
  // Mesa gratis: nada que proteger, todo sigue como estaba.
  if (!check.escrowed) return { ok: true };

  // Puerta 1: la ficha. Sin ella no hay nada que mirar — y da igual qué sesión
  // se traiga, porque ninguna sesión sustituye a la prueba de la silla.
  if (!check.seat) return { ok: false, error: "seat_token_required" };

  // Una ficha vale para SU mesa. Sin este cheque, la de una mesa barata
  // abriría una cara, que es la forma tonta de perder todo lo anterior.
  if (norm(check.seat.tableId) !== norm(check.tableId)) {
    return { ok: false, error: "seat_token_wrong_table" };
  }

  // Puerta 2: la silla la da el contrato, no la ficha. Se comprueban las dos
  // porque responden preguntas distintas: la ficha, que quien pide conoce el
  // secreto; la cadena, que esa dirección pagó de verdad. Una mesa anulada o
  // una devolución dejan la lista vacía, y ahí la ficha deja de servir sola.
  const players = check.onchainPlayers.map(norm);
  if (!players.includes(norm(check.seat.address))) {
    return { ok: false, error: "seat_not_paid" };
  }

  return { ok: true };
}

/**
 * ── Y quién ACTÚA desde la silla (regla del 2026-08-08) ───────────────────
 *
 * `decideSeatAccess` responde si se puede tocar la silla; esto responde con
 * QUIÉN se actúa, que es una pregunta distinta y estuvo mal contestada.
 *
 * **En una mesa con entrada manda la wallet que probó la ficha, no el perfil de
 * la sesión.** La silla la paga una dirección y la prueba un secreto que solo su
 * dueño tiene; la sesión no participa en ninguna de las dos cosas.
 *
 * Es la mitad que faltaba de la decisión de `/rooms/[code]/paid`. Registrar la
 * silla dejó de necesitar sesión, pero si JUGARLA seguía dependiendo de
 * `profile_id`, el problema solo se movía de sitio: un jugador de Privy cuyo
 * perfil no tuviera escrita la dirección con la que pagó acababa con la silla en
 * un perfil y la sesión en otro, registrado y sin poder tocar el botón de listo.
 * Pagó, y la aplicación no lo reconoce. Ese final es el que no puede existir.
 *
 * En una mesa gratis no hay ficha ni dirección que probar, así que manda la
 * sesión, exactamente como hasta hoy.
 *
 * Vive aquí, y no junto al código que lo usa, por la misma razón que el resto de
 * este archivo: quien lo usa habla HTTP —importa `next/server`— y eso deja la
 * regla fuera del alcance de `node scripts/verify-arena-actor.ts`. Una regla que
 * decide sobre dinero ajeno tiene que poder correrse sola.
 */

export type ActorRefusal =
  /** Mesa gratis sin sesión válida. */
  | "unauthorized"
  /**
   * Mesa con entrada: la ficha vale, pero de esa dirección no consta silla.
   * Es "termina de registrar el pago", no "no tienes permiso" — y por eso
   * merece un 409 y no un 403: la respuesta es reintentar `/paid`, que no
   * cobra nada.
   */
  | "seat_not_registered";

export type ActorVerdict =
  | { ok: true; profileId: string }
  | { ok: false; error: ActorRefusal };

/**
 * Con qué perfil se actúa sobre las filas de una sala.
 *
 * Lo que hay que leer aquí es lo que NO aparece: en el camino de una mesa con
 * entrada, `sessionProfileId` no se mira ni una vez. No es que se prefiera la
 * silla y se caiga a la sesión si falta — es que la sesión no puede decidir
 * quién juega una silla pagada, ni cuando existe ni cuando falta.
 */
export function decideActor(check: {
  /** ¿Esta sala cobra entrada? */
  escrowed: boolean;
  /** Perfil de la sesión, si vino y valía. Solo cuenta en mesas gratis. */
  sessionProfileId: string | null;
  /** Perfil dueño de la silla cuya dirección probó la ficha. */
  seatProfileId: string | null;
}): ActorVerdict {
  if (check.escrowed) {
    if (!check.seatProfileId) return { ok: false, error: "seat_not_registered" };
    return { ok: true, profileId: check.seatProfileId };
  }

  if (!check.sessionProfileId) return { ok: false, error: "unauthorized" };
  return { ok: true, profileId: check.sessionProfileId };
}
