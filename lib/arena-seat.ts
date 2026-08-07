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
 * Por eso aquí hay dos puertas y solo una sirve para las mesas con dinero:
 *
 *   - **Sesión de Privy** (`privyId` presente) — viene de un correo verificado
 *     o de una firma SIWE. Detrás hay una credencial que no se puede leer de la
 *     cadena. Sirve.
 *   - **Sesión de wallet** (`privyId` nulo) — la de MiniPay, canjeada por el
 *     hash de una jugada. NO sirve en mesas con entrada.
 *
 * La consecuencia hay que decirla sin adornos: **dentro de MiniPay no se puede
 * jugar una mesa con entrada**, porque ahí no existe forma de firmar un mensaje
 * y por tanto no hay sesión de Privy posible. Las mesas gratis siguen abiertas
 * para todo el mundo. Es una pérdida real de alcance, y es preferible a cobrar
 * una entrada que no podemos proteger.
 *
 * ── Y la silla la da la cadena ────────────────────────────────────────────
 *
 * En una mesa con escrow, quién está sentado NO lo dice una fila creada por una
 * sesión: lo dice el contrato, que solo conoce a quien pagó. El servidor lee esa
 * lista y no se cree ninguna otra.
 */

import type { AppIdentity } from "./identity";

/** Qué se quiere hacer con la silla. */
export type SeatAction =
  /** Sentarse en una mesa. */
  | "join"
  /** Decir "listo", empezar la partida, mover, o levantarse. */
  | "act";

export type SeatVerdict =
  | { ok: true }
  /**
   * La mesa cobra entrada y la sesión no puede autorizar dinero. 403: no es que
   * falte identificarse, es que ESA identidad no vale aquí.
   */
  | { ok: false; error: "session_not_allowed_on_paid_table" }
  /** La sesión no tiene wallet con la que poder estar en una mesa pagada. */
  | { ok: false; error: "wallet_required" }
  /** Esa dirección no pagó esta mesa: la cadena no la conoce. */
  | { ok: false; error: "seat_not_paid" };

export interface SeatCheck {
  /**
   * La mesa tiene escrow en el contrato. Mientras sea `false` la Arena se
   * comporta como hasta hoy — que es lo que permite desplegar este cambio antes
   * que el contrato sin romperle la partida a nadie.
   */
  escrowed: boolean;
  identity: AppIdentity;
  /** Direcciones que pagaron esta mesa, leídas del contrato. En minúsculas. */
  onchainPlayers: readonly string[];
  action: SeatAction;
}

const norm = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

export function decideSeatAccess(check: SeatCheck): SeatVerdict {
  // Mesa gratis: nada que proteger, todo sigue como estaba.
  if (!check.escrowed) return { ok: true };

  // Puerta 1: la sesión. Una abierta con un txHash no vale en mesas con dinero.
  if (!check.identity.privyId) {
    return { ok: false, error: "session_not_allowed_on_paid_table" };
  }

  const wallet = norm(check.identity.walletAddress);
  if (!wallet) return { ok: false, error: "wallet_required" };

  // Puerta 2: la silla. La da el contrato, no la base de datos.
  //
  // Vale igual para sentarse y para actuar: si la dirección no está en la lista
  // de pagadores, no hay silla que ocupar ni desde la que jugar. Al sentarse la
  // transacción de `join` ya está minada —es lo que crea la silla—, así que la
  // lista tiene que incluirla; si no la incluye, esa persona no pagó.
  const players = check.onchainPlayers.map(norm);
  if (!players.includes(wallet)) return { ok: false, error: "seat_not_paid" };

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
