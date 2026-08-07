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
 * ¿Esta acción puede hacer perder dinero a alguien?
 *
 * Se usa para decidir qué se cierra en una mesa con entrada. Levantarse de una
 * mesa pagada NO es una acción que deba existir por API: el contrato paga al
 * que se queda, así que "irse" es regalar la entrada, y una sesión robada no
 * puede tener a mano un botón que regala el dinero de otro. Ausentarse sigue
 * siendo posible —basta con dejar de aparecer—, pero eso no lo puede provocar
 * un tercero desde fuera.
 */
export function isForfeitAction(action: string): boolean {
  return action === "leave";
}
