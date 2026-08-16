/**
 * El robot que mantiene los pozos en su suelo.
 *
 * Separado de la liquidación A PROPÓSITO: sembrar era un efecto secundario del
 * cierre y por eso una liquidación rara dejó los tres pozos en 0,00 sin que
 * nada los recuperara (ver la cabecera de `seed-rules.ts`). Ahora es un trabajo
 * propio, idempotente y con su propio reloj: `/api/cron/seed-pots`.
 *
 * Este módulo NO importa viem ni Supabase: todo lo que toca el mundo entra por
 * `SeedDeps`. Así el verificador (`scripts/verify-seed-floor.ts`) corre el
 * robot ENTERO con `node`, contra una cadena y una base de datos de mentira,
 * incluidas las dos cosas que de verdad dan miedo: dos corridas solapadas y una
 * transacción que falla. Las dependencias de verdad viven en `seed-chain.ts`
 * (firma) y `seed-db.ts` (cerrojo).
 */

import {
  planSeed,
  isClosePending,
  msSinceUtcMidnight,
  fmtUnits,
  FLOOR_UNITS,
  ROUND_CAP_UNITS,
  RUN_CAP_UNITS,
  SKIP,
} from "./seed-rules.ts";

/** Los tres mazos, en el mismo orden en que los lista el resto del juego. */
export const SEED_DECKS = [10, 15, 20];

/**
 * Cuánto se le da a la liquidación para aterrizar antes de sembrar igual.
 *
 * En una noche normal `settle` entra a las 00:00:10 y deja su fila, así que a
 * la primera corrida (minuto :35) ya consta y no se espera nada. Esta ventana
 * solo importa la noche en que el cierre se retrasa.
 */
export const CLOSE_WINDOW_MS =
  Math.max(0, Number(process.env.SEED_CLOSE_WINDOW_MINUTES ?? 90)) * 60_000;

/** Cuánto dura el cerrojo de un mazo. Sembrar uno tarda segundos. */
export const LEASE_MS =
  Math.max(30, Number(process.env.SEED_LEASE_SECONDS ?? 120)) * 1000;

/* ------------------------------ Fechas de ronda ---------------------------- */

const DAY_MS = 86_400_000;

/** La ronda ABIERTA (hoy UTC). Es la que recibe la siembra. */
export function currentRound(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** La ronda que acaba de CERRAR (ayer UTC). Es la que tenía que liquidarse. */
export function closedRound(nowMs: number): string {
  return new Date(nowMs - DAY_MS).toISOString().slice(0, 10);
}

/* -------------------------------- Contratos -------------------------------- */

export interface FunderState {
  address: string;
  balance: bigint;
  allowance: bigint;
}

export interface SendResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

export interface LeaseRow {
  /** Ronda a la que corresponde `spentUnits`. */
  roundDate: string;
  /** Lo que la casa ya puso en este mazo durante esa ronda. */
  spentUnits: bigint;
}

export interface ReleasePatch {
  roundDate: string;
  spentUnits: bigint;
  txHash?: string;
  error?: string;
}

export interface SeedDeps {
  /** Saldo del pozo de un mazo, en unidades del token. */
  readPot(deck: number): Promise<bigint>;
  /** USDT y allowance del Funder frente al contrato del pozo. */
  readFunder(): Promise<FunderState>;
  /** ¿La ronda que cerró ya consta liquidada para este mazo? */
  isSettled(roundDate: string, deck: number): Promise<boolean>;
  /** Toma el cerrojo del mazo. `null` = lo tiene otra corrida ahora mismo. */
  claim(deck: number, leaseMs: number): Promise<LeaseRow | null>;
  /** Suelta el cerrojo anotando lo que pasó. */
  release(deck: number, patch: ReleasePatch): Promise<void>;
  /** Firma `seedPot(deck, amount)` y espera el recibo. */
  sendSeed(deck: number, amount: bigint): Promise<SendResult>;
  now(): number;
}

/* --------------------------------- Informe --------------------------------- */

export type DeckAction = "sembrado" | "saltado" | "abortado" | "falló";

export interface DeckReport {
  deck: number;
  action: DeckAction;
  reason?: string;
  potBefore: string;
  potAfter: string;
  amount: string;
  txHash?: string;
  error?: string;
  /** El pozo TERMINÓ por debajo del suelo por un motivo que hay que mirar. */
  belowFloor: boolean;
}

export interface SeedRunReport {
  round: string;
  funder?: string;
  funderBalance?: string;
  funderAllowance?: string;
  decks: DeckReport[];
  /** Algo quedó mal y hay que mirarlo. Es lo que enciende la alarma. */
  alarm: boolean;
  /** Frases listas para el log y para el cuerpo de la respuesta. */
  lines: string[];
}

/* ---------------------------------- Robot ---------------------------------- */

/**
 * Lleva cada mazo hasta el suelo, uno por uno.
 *
 * Secuencial a propósito. La tanda en paralelo con el nonce llevado a mano es
 * justo lo que reventó la noche del 16: el Funder es la misma wallet que
 * siembra TypeRush, los dos robots leyeron el mismo nonce pendiente en el mismo
 * segundo y las tres siembras de Avíspate se cayeron sin que nadie mirara.
 * Aquí cada transacción pide su nonce fresco, espera su recibo y reintenta si
 * choca; son tres mazos y no hay ninguna prisa, porque esto corre cada hora.
 */
export interface SeedRunOptions {
  /**
   * Instante a partir del cual no se empieza un mazo nuevo. Cortar limpio es
   * gratis (el trabajo es idempotente y vuelve a correr en una hora); que
   * Vercel mate la función a mitad no lo es, porque deja el cerrojo tomado
   * hasta que vence el arriendo.
   */
  deadlineMs?: number;
}

export async function seedToFloor(
  deps: SeedDeps,
  decks: number[] = SEED_DECKS,
  opts: SeedRunOptions = {}
): Promise<SeedRunReport> {
  const nowMs = deps.now();
  const round = currentRound(nowMs);
  const closed = closedRound(nowMs);
  const sinceClose = msSinceUtcMidnight(nowMs);

  const report: SeedRunReport = { round, decks: [], alarm: false, lines: [] };

  let funder: FunderState;
  try {
    funder = await deps.readFunder();
  } catch (e) {
    report.alarm = true;
    report.lines = [`No se pudo leer el Funder: ${errMsg(e, "read_failed")}`];
    return report;
  }
  report.funder = funder.address;
  report.funderBalance = fmtUnits(funder.balance);
  report.funderAllowance = fmtUnits(funder.allowance);

  for (const deck of decks) {
    if (opts.deadlineMs !== undefined && deps.now() >= opts.deadlineMs) {
      report.decks.push({
        deck,
        action: "saltado",
        reason: SKIP.NO_TIME,
        potBefore: "?",
        potAfter: "?",
        amount: "0.00",
        belowFloor: false,
      });
      continue;
    }
    const row = await runDeck(deck, deps, { round, closed, sinceClose, funder });
    report.decks.push(row);
    if (row.belowFloor || row.action === "abortado" || row.action === "falló") {
      report.alarm = true;
    }
  }

  report.lines = report.decks.map(describe);
  return report;
}

interface RunContext {
  round: string;
  closed: string;
  sinceClose: number;
  funder: FunderState;
}

async function runDeck(
  deck: number,
  deps: SeedDeps,
  ctx: RunContext
): Promise<DeckReport> {
  const base = (pot: bigint): DeckReport => ({
    deck,
    action: "saltado",
    potBefore: fmtUnits(pot),
    potAfter: fmtUnits(pot),
    amount: "0.00",
    belowFloor: false,
  });

  // El cerrojo va PRIMERO, antes de leer nada caro. Dos corridas solapadas (el
  // cron de Vercel y el de Supabase pisándose) leerían las dos el mismo pozo en
  // cero y sembrarían las dos: 0,60 en vez de 0,30. Con el cerrojo la segunda
  // se va por aquí sin gastar ni una lectura de cadena.
  const lease = await deps.claim(deck, LEASE_MS);
  if (!lease) {
    return { ...base(0n), reason: SKIP.LOCKED };
  }

  let pot = 0n;
  try {
    pot = await deps.readPot(deck);

    // Lo gastado solo cuenta dentro de su ronda: al cambiar el día se reinicia.
    const spentThisRound =
      lease.roundDate === ctx.round ? lease.spentUnits : 0n;

    const settled = await deps.isSettled(ctx.closed, deck);
    const closePending = isClosePending(settled, ctx.sinceClose, CLOSE_WINDOW_MS);

    const decision = planSeed({
      pot,
      floor: FLOOR_UNITS,
      spentThisRound,
      roundCap: ROUND_CAP_UNITS,
      runCap: RUN_CAP_UNITS,
      closePending,
      funderBalance: ctx.funder.balance,
      allowance: ctx.funder.allowance,
    });

    if (!decision.act) {
      await deps.release(deck, {
        roundDate: ctx.round,
        spentUnits: spentThisRound,
      });
      return {
        ...base(pot),
        action: decision.kind === "abort" ? "abortado" : "saltado",
        reason: decision.reason,
        amount: fmtUnits(decision.amount),
        // "ya-en-suelo" no es alarma, y "cierre-pendiente" tampoco: el pozo
        // está justo a punto de moverse y la corrida siguiente lo recoge. Un
        // aborto sí, y quedarse corto por el tope de ronda también.
        belowFloor:
          decision.kind === "abort" || decision.reason === SKIP.ROUND_CAP,
      };
    }

    const sent = await deps.sendSeed(deck, decision.amount);
    if (!sent.ok) {
      // El cerrojo se suelta SIN contar el gasto: la plata no salió, así que la
      // corrida siguiente tiene que poder volver a intentarlo.
      await deps.release(deck, {
        roundDate: ctx.round,
        spentUnits: spentThisRound,
        error: sent.error,
      });
      return {
        ...base(pot),
        action: "falló",
        amount: fmtUnits(decision.amount),
        error: sent.error,
        belowFloor: true,
      };
    }

    const after = await deps
      .readPot(deck)
      .catch(() => pot + decision.amount);
    await deps.release(deck, {
      roundDate: ctx.round,
      spentUnits: spentThisRound + decision.amount,
      txHash: sent.txHash,
    });

    return {
      deck,
      action: "sembrado",
      potBefore: fmtUnits(pot),
      potAfter: fmtUnits(after),
      amount: fmtUnits(decision.amount),
      txHash: sent.txHash,
      belowFloor: after < FLOOR_UNITS,
    };
  } catch (e) {
    // Pase lo que pase, el cerrojo se suelta. Uno colgado por una excepción
    // dejaría el mazo intocable hasta que venciera el arriendo.
    await deps
      .release(deck, {
        roundDate: ctx.round,
        spentUnits: lease.roundDate === ctx.round ? lease.spentUnits : 0n,
        error: errMsg(e, "seed_failed"),
      })
      .catch(() => {});
    return {
      ...base(pot),
      action: "falló",
      error: errMsg(e, "seed_failed"),
      belowFloor: true,
    };
  }
}

/**
 * La siembra ENCADENADA al cierre. Igual que `seedToFloor`, pero no lanza nunca.
 *
 * `roll-day` la llama justo después de escribir `round_settlements` para que el
 * pozo vuelva a su suelo en segundos en vez de esperar al cron — a las 7 p. m.
 * de Colombia, que es la hora en la que más gente está mirando la pantalla.
 *
 * El contrato con el cierre es de una sola dirección: el cierre ya PAGÓ premios
 * cuando esto corre, así que su resultado no puede depender de que la siembra
 * salga bien. Aquí se traga cualquier excepción y se devuelve un informe con la
 * alarma encendida; quien llama lo adjunta a su respuesta y sigue como si nada.
 * Si falla, lo recoge el respaldo de las 00:07 y, tras él, el horario de las :35.
 */
export async function seedAfterSettle(
  deps: SeedDeps,
  decks: number[] = SEED_DECKS,
  opts: SeedRunOptions = {}
): Promise<SeedRunReport> {
  try {
    return await seedToFloor(deps, decks, opts);
  } catch (e) {
    const motivo = errMsg(e, "seed_failed");
    let round = "?";
    try {
      round = currentRound(deps.now());
    } catch {
      // Ni la hora se pudo leer. Da igual: lo que importa es no relanzar.
    }
    return {
      round,
      decks: [],
      alarm: true,
      lines: [`la siembra encadenada se cayó entera: ${motivo}`],
    };
  }
}

function describe(r: DeckReport): string {
  const head = `mazo ${r.deck} · pozo ${r.potBefore}`;
  if (r.action === "sembrado") {
    return `${head} → aporta ${r.amount} (hasta el suelo ${fmtUnits(
      FLOOR_UNITS
    )}) → ${r.potAfter} · ${r.txHash}`;
  }
  if (r.action === "saltado") return `${head} → ${r.reason}`;
  if (r.action === "abortado") {
    return `${head} → ABORTA ${r.reason} (calculaba ${r.amount})`;
  }
  return `${head} → FALLÓ al sembrar ${r.amount}: ${r.error}`;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
