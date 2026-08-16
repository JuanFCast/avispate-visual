/**
 * La regla de recarga de los pozos de Avíspate, aislada y sin efectos.
 *
 * Vive aparte del robot porque es LA pieza que puede costar dinero si se
 * equivoca, y así se puede probar entera sin cadena, sin claves y sin red
 * (`scripts/verify-seed-floor.ts`). El robot solo lee la cadena, le pregunta a
 * esto qué hacer, y firma.
 *
 * ── Qué problema resuelve ─────────────────────────────────────────────────
 *
 * Hasta el 2026-08-16 sembrar era un EFECTO SECUNDARIO de liquidar: al final
 * de `/api/cron/roll-day` se llamaba `seedPots([...txByDeck.keys()])`, o sea
 * "resiembro los mazos que acabo de pagar". Una sola vez, sin reintento y sin
 * nadie mirando.
 *
 * La madrugada del 16 esa siembra no salió (el Funder es la MISMA wallet que
 * siembra TypeRush y los dos robots despertaron en el mismo segundo, cada uno
 * llevando su nonce a mano). Y ahí se vio que el fallo no era recuperable:
 *
 *   - el reintento de las 00:05 encuentra las filas en `round_settlements` y
 *     devuelve `already_settled` sin sembrar; y
 *   - a partir del día siguiente `payable` exige `pot > 0`, así que un mazo en
 *     cero ya ni entra a liquidarse — y sin liquidación no hay resiembra.
 *
 * Cero era un estado absorbente: los tres pozos se quedaron en 0,00 y el juego
 * siguió abierto, cobrando entradas por un premio que no existía.
 *
 * ── El cambio ─────────────────────────────────────────────────────────────
 *
 * Sembrar deja de ser "resiembro lo que pagué" y pasa a ser **completar hasta
 * un suelo**: `faltante = max(0, SUELO − pozo)`. Es idempotente por
 * construcción — el destino es un tope, no un incremento —, así que se puede
 * correr cada hora sin acumular, y que una corrida falle no cuesta nada porque
 * la siguiente lo arregla sola. Es lo mismo que hace `_seed-rules.mjs` en
 * TypeRush, que llegó ahí después de vivir exactamente este fallo.
 *
 * Lo que NO se copia de TypeRush: allí el pozo está indexado por día
 * (`pool[día][modo][token]`) y `rollover` mueve el de ayer al día activo, así
 * que la guarda de cierre puede esperar indefinidamente sin riesgo. Aquí
 * `pot[mazo]` es un único saldo corriente que `settle` vacía, y la guarda de
 * cierre tiene que estar ACOTADA en el tiempo: si esperase para siempre a una
 * liquidación que no llega, reproduciría el mismo pozo muerto que venimos a
 * arreglar. Ver `closePending` más abajo.
 */

/** Suelo por mazo, en unidades de USDT (6 decimales). 0,30 USDT. */
export const FLOOR_UNITS = 300_000n;

/**
 * Tope de lo que la casa pone por mazo y ronda.
 *
 * El gasto legítimo de un día es un suelo entero (el pozo solo baja cuando
 * `settle` lo vacía, y eso pasa una vez al día). Se deja en DOS suelos para
 * absorber el único caso honesto en que hacen falta dos siembras el mismo día:
 * sembrar unos segundos antes de que `settle` entre y se lleve lo sembrado.
 * Más que eso ya no es un caso honesto, es un robot en bucle, y aquí se para.
 */
export const ROUND_CAP_UNITS = FLOOR_UNITS * 2n;

/**
 * Tope por transacción. El aporte legítimo máximo es el suelo entero, así que
 * esto solo salta si algo está mal (un suelo mal escrito, una lectura absurda
 * del pozo). Está para que eso no vacíe el Funder.
 */
export const RUN_CAP_UNITS = FLOOR_UNITS;

/** Motivos por los que NO se siembra. No son errores; se imprimen tal cual. */
export const SKIP = {
  /** El pozo ya llega al suelo (rodó, o la gente pagó entradas). */
  AT_FLOOR: "ya-en-suelo",
  /** La ronda que cerró aún no consta liquidada: puede haber dinero en camino. */
  CLOSE_PENDING: "cierre-pendiente",
  /** Este mazo ya recibió su tope de la casa en esta ronda. */
  ROUND_CAP: "tope-de-ronda",
  /** Otra corrida tiene el cerrojo de este mazo ahora mismo. */
  LOCKED: "sembrando-en-otra-corrida",
  /**
   * Se acabó el presupuesto de la función antes de llegar a este mazo. No es un
   * fallo: la corrida siguiente lo recoge, y por eso no enciende la alarma.
   */
  NO_TIME: "sin-tiempo",
} as const;

/** Motivos por los que se ABORTA: no es un salto, algo está mal. */
export const ABORT = {
  /** El aporte calculado supera el tope por transacción. */
  OVER_CAP: "tope-superado",
  /** Al Funder no le alcanza el USDT. */
  NO_BALANCE: "saldo-insuficiente",
  /** El Funder no tiene aprobado al contrato por ese monto. */
  NO_ALLOWANCE: "allowance-insuficiente",
} as const;

export interface SeedInput {
  /** Saldo actual del pozo del mazo, leído de la cadena. */
  pot: bigint;
  /** Suelo al que hay que llegar. */
  floor: bigint;
  /** Lo que la casa ya puso en ESTE mazo durante ESTA ronda. */
  spentThisRound: bigint;
  /** Tope por mazo y ronda. */
  roundCap: bigint;
  /** Tope por transacción. */
  runCap: bigint;
  /**
   * La ronda que acaba de cerrar todavía no consta liquidada Y seguimos dentro
   * de la ventana en que es razonable esperarla. Quien lo calcula es
   * `isClosePending`, que es donde vive el acotado en el tiempo.
   */
  closePending: boolean;
  /** USDT del Funder. */
  funderBalance: bigint;
  /** Lo que el Funder tiene aprobado al contrato del pozo. */
  allowance: bigint;
}

export type SeedDecision =
  /** No se hace nada, y no pasa nada. */
  | { act: false; kind: "skip"; reason: string; amount: bigint }
  /** No se hace nada y hay que mirarlo. */
  | { act: false; kind: "abort"; reason: string; amount: bigint }
  /** Sembrar exactamente `amount`. */
  | { act: true; amount: bigint };

/**
 * Qué hacer con un mazo. Sin efectos: recibe la foto y devuelve la decisión.
 *
 * El orden de las comprobaciones importa y es deliberado:
 *
 *   1. `cierre-pendiente` va primero porque es la guarda de SEGURIDAD: mientras
 *      `settle` pueda estar a punto de vaciar el pozo, ni siquiera se mira
 *      cuánto falta. Sembrar en ese hueco regala el suelo al ganador de ayer.
 *   2. `ya-en-suelo` antes de calcular nada: es el caso normal, el de todas las
 *      corridas de en medio del día, y tiene que salir barato y sin ruido.
 *   3. Los topes antes que los fondos: un aporte absurdo se para aunque el
 *      Funder tenga con qué pagarlo.
 */
export function planSeed(input: SeedInput): SeedDecision {
  const {
    pot,
    floor,
    spentThisRound,
    roundCap,
    runCap,
    closePending,
    funderBalance,
    allowance,
  } = input;

  if (closePending) {
    return { act: false, kind: "skip", reason: SKIP.CLOSE_PENDING, amount: 0n };
  }

  if (pot >= floor) {
    return { act: false, kind: "skip", reason: SKIP.AT_FLOOR, amount: 0n };
  }

  // Aquí está la idempotencia entera: el destino es el suelo, no un incremento.
  // Correr esto dos veces seguidas con el pozo ya recargado da 0 la segunda vez.
  const amount = floor - pot;

  if (amount > runCap) {
    return { act: false, kind: "abort", reason: ABORT.OVER_CAP, amount };
  }

  if (spentThisRound + amount > roundCap) {
    return { act: false, kind: "skip", reason: SKIP.ROUND_CAP, amount };
  }

  if (funderBalance < amount) {
    return { act: false, kind: "abort", reason: ABORT.NO_BALANCE, amount };
  }

  if (allowance < amount) {
    return { act: false, kind: "abort", reason: ABORT.NO_ALLOWANCE, amount };
  }

  return { act: true, amount };
}

/**
 * ¿Hay que esperar a que la liquidación aterrice antes de sembrar?
 *
 * `settle` vacía el pozo del mazo. Si se siembra en los minutos anteriores, lo
 * sembrado se lo lleva el ganador de AYER y el pozo de hoy vuelve a quedar en
 * cero — la casa paga dos suelos y el jugador de la mañana ve 0,00.
 *
 * Pero esta guarda no puede esperar para siempre. En TypeRush sí puede, porque
 * allí el pozo está indexado por día y el dinero de ayer no estorba al de hoy;
 * aquí, si `roll-day` se cayera del todo, esperar indefinidamente dejaría el
 * pozo muerto — que es el bug que estamos arreglando. Así que se espera solo
 * dentro de una ventana; pasada esa hora se siembra igual, asumiendo el coste
 * de un suelo de más, y la alarma se encarga de gritar que la ronda de ayer
 * sigue sin pagar.
 *
 * @param settled       la ronda que cerró ya consta en `round_settlements`
 * @param msSinceClose  milisegundos desde el cierre (00:00 UTC)
 * @param windowMs      cuánto se le da a la liquidación para aterrizar
 */
export function isClosePending(
  settled: boolean,
  msSinceClose: number,
  windowMs: number
): boolean {
  if (settled) return false;
  return msSinceClose < windowMs;
}

/** Milisegundos transcurridos desde el último corte de medianoche UTC. */
export function msSinceUtcMidnight(nowMs: number): number {
  return ((nowMs % 86_400_000) + 86_400_000) % 86_400_000;
}

/** "0.30" a partir de unidades de 6 decimales, para los informes. */
export function fmtUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
