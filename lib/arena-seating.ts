/**
 * Quién ocupa qué asiento, y por qué puerta.
 *
 * Función pura y sin base de datos, como el resto de las reglas que deciden
 * sobre dinero ajeno: se corre entera desde `scripts/verify-arena-seating.ts`.
 *
 * ── Las dos puertas, y por qué una está cerrada en las mesas pagas ─────────
 *
 * Una silla se crea por `/rooms/join` (mesa gratis) o por `/rooms/[code]/paid`
 * (mesa con entrada, contra un `Joined` verificado en la cadena). Eran dos
 * puertas y la primera no sabía que la segunda existía: `joinRoom` insertaba
 * una fila SIN `wallet_address` ni `paid_at` en cualquier sala, también en una
 * que cobra.
 *
 * No era teórico. Bastaba con pagar una entrada de esa mesa, canjear la ficha
 * en `/api/arena/seat` —que no pasa por `/paid`— y llamar a `/rooms/join` con
 * una sesión de Privy recién hecha, cuyo perfil no tiene fila. El guardia de
 * sillas dejaba pasar porque solo mira que la ficha sea de una dirección que
 * pagó; no mira qué fila se va a crear. Resultado: una silla sin pago sentada
 * en una mesa con dinero, y dos daños detrás de ella:
 *
 *   · La mesa no arranca nunca. `decideMatchStart` exige que todos los sentados
 *     estén en la lista de pagadores del contrato, y esa fila no lo está.
 *   · Y un pagador legítimo se queda SIN REGISTRAR. La fila de más corre los
 *     asientos, y el último en pagar se sale del rango que la base acepta.
 *
 * Así que en una mesa con entrada esta puerta no existe: **la silla la crea el
 * pago y nadie más**. No es una comprobación de permiso —quien llama puede
 * tener todos los permisos del mundo— es que la operación no aplica.
 */

export type SeatingRefusal =
  /** La mesa cobra: aquí no se crean sillas, las crea el pago. */
  | "room_is_paid"
  /** No queda asiento libre. */
  | "room_full";

export type JoinVerdict =
  | { ok: true; seat: number }
  | { ok: false; error: SeatingRefusal };

/**
 * El primer asiento libre entre `0` y `maxPlayers - 1`, o `null` si no hay.
 *
 * El PRIMERO libre, no el siguiente al último. La diferencia solo se nota
 * cuando quedan huecos en medio —una silla sin pagar que caducó, una sala que
 * perdió a alguien— y ahí es la diferencia entre sentar a la gente y romperse:
 * `max(asiento) + 1` sobre los asientos {0, 2} da 3, y sobre {0, 1, 2, 3} da 4,
 * que la base rechaza por `check (seat between 0 and 3)`. Ese rechazo no es un
 * conflicto que se pueda reintentar: es una excepción, y en `/paid` significaba
 * un 500 permanente delante de alguien que ya había pagado.
 *
 * Buscar el primer hueco no puede pasarse del rango por construcción.
 */
export function firstFreeSeat(
  taken: readonly number[],
  maxPlayers: number
): number | null {
  const ocupados = new Set(taken);
  for (let seat = 0; seat < maxPlayers; seat++) {
    if (!ocupados.has(seat)) return seat;
  }
  return null;
}

/**
 * ¿Puede `/rooms/join` sentar a alguien aquí, y en qué asiento?
 *
 * El orden de los cheques es parte de la regla: la mesa paga se rechaza ANTES
 * de mirar nada más. No importa quién llame, ni si hay sitio, ni si ya estaba
 * sentado — por esta puerta no se crea una silla en una mesa con dinero.
 */
export function decideRoomJoin(check: {
  /** La mesa en el contrato, o `null` si la sala es gratis. */
  tableId: string | null;
  /** Asientos ya ocupados en la sala. */
  taken: readonly number[];
  maxPlayers: number;
}): JoinVerdict {
  if (check.tableId) return { ok: false, error: "room_is_paid" };

  const seat = firstFreeSeat(check.taken, check.maxPlayers);
  if (seat === null) return { ok: false, error: "room_full" };
  return { ok: true, seat };
}
