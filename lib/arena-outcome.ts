/**
 * Cómo termina una mesa con dinero, y a quién hay que pagarle.
 *
 * Función pura: recibe el estado de la partida y devuelve la instrucción. No
 * habla con la cadena ni con la base, así que `scripts/verify-arena-outcome.ts`
 * puede recorrer los finales feos —el que se desconecta justo al perder, los dos
 * que se van a la vez, el que vuelve dentro del margen— sin montar una partida.
 *
 * ── Las reglas, que las decidió Juan el 2026-08-07 ────────────────────────
 *
 *   · **Abandonar no devuelve nada.** Quien se va o no vuelve dentro del margen
 *     pierde, y cobra quien se quedó. Si devolviera la entrada, perder saldría
 *     gratis: bastaría con cerrar la pestaña al ver que vas mal.
 *   · **Solo se devuelve por fallo técnico**, cuando no se puede determinar un
 *     ganador legítimo ni continuar.
 *
 * De ahí sale el único caso que parece raro y no lo es: si se van TODOS, no hay
 * a quién pagarle, así que se anula. No es una puerta de escape — los dos
 * pierden lo mismo que pusieron y nadie gana nada; ponerse de acuerdo para
 * hacerlo solo cuesta la tarifa de red.
 */

export interface SeatState {
  /** Dirección que pagó la silla. Es a quien puede pagarle el contrato. */
  address: string;
  /** Se quedó sin cartas: ganó jugando. */
  cleared: boolean;
  /** Se levantó explícitamente. */
  left: boolean;
  /** Cuándo se le vio por última vez (ms). */
  lastSeenAt: number;
}

export type MatchOutcome =
  /** Todavía hay partida. */
  | { kind: "playing" }
  /** Hay que pagar a alguien. */
  | { kind: "settle"; winner: string; reason: "cleared" | "abandoned" }
  /** No hay ganador legítimo posible: se anula y se devuelve. */
  | { kind: "void"; why: "everyone_left" };

/**
 * @param graceMs cuánto se espera sin ver a alguien antes de darlo por ido.
 *                Con dinero encima conviene que sea generoso: perder la entrada
 *                por un túnel o una llamada de cincuenta segundos es duro, y el
 *                rival tampoco espera tanto.
 */
export function decideMatchOutcome(
  seats: readonly SeatState[],
  now: number,
  graceMs: number
): MatchOutcome {
  if (seats.length === 0) return { kind: "void", why: "everyone_left" };

  // Ganar jugando manda sobre todo lo demás. Importa el orden: si alguien vacía
  // su mazo y en ese mismo instante otro se desconecta, ganó el que terminó, no
  // el que se quedó — y sin esta prioridad podría resolverse al revés.
  const cleared = seats.find((s) => s.cleared);
  if (cleared) return { kind: "settle", winner: cleared.address, reason: "cleared" };

  const present = seats.filter(
    (s) => !s.left && now - s.lastSeenAt <= graceMs
  );

  // Queda uno solo: los demás se fueron o no volvieron. Cobra el que aguantó.
  if (present.length === 1) {
    return { kind: "settle", winner: present[0].address, reason: "abandoned" };
  }

  // No queda nadie a quien pagarle.
  if (present.length === 0) return { kind: "void", why: "everyone_left" };

  return { kind: "playing" };
}
