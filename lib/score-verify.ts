/**
 * Verificación server-side del reto diario: el servidor rejuega el MISMO mazo
 * que vio el cliente (misma semilla, mismo `generateFirstCard`/
 * `generateNextCard` de `lib/game.ts`) y solo confía en el tiempo/errores que
 * él mismo recalcula a partir de la secuencia real de toques — nunca en el
 * `totalMs`/`averageMs`/`errors` que mande el cliente.
 *
 * Antes de esto, `/api/scores` aceptaba esos cuatro números tal cual llegaran:
 * un `POST` a mano con `averageMs: 1` y un `txHash` real de una jugada
 * cualquiera ganaba el pozo del día sin jugar nada. Ver la auditoría del
 * 2026-08-13.
 *
 * Reutiliza el generador con semilla que ya usaba la Arena (`seededRnd` de
 * `lib/arena-deck.ts`) — no se inventó uno nuevo.
 */

import {
  generateFirstCard,
  generateNextCard,
  computeAccuracy,
  ERROR_PENALTY_MS,
  type Rnd,
} from "./game.ts";
import { seededRnd } from "./arena-deck.ts";
import { SYMBOL_BY_ID } from "./symbols.ts";

/**
 * Piso físico de tiempo entre dos aciertos consecutivos. Deliberadamente muy
 * conservador: no existe para exigirle velocidad a nadie, existe para que
 * `averageMs: 1` sea matemáticamente imposible. Ningún jugador real —ni el más
 * rápido— resuelve una búsqueda visual entre 8 símbolos y toca la pantalla en
 * menos de esto de forma sostenida; una sola carta de suerte sí podría rozarlo,
 * por eso el número es bajo a propósito.
 */
export const MIN_MS_PER_CARD = 120;

/** Cota generosa de cuántos toques puede traer un envío. Es una defensa contra
    payloads absurdos, no una regla del juego: hasta con muchísimos errores un
    mazo real nunca se acerca a esto. */
const MAX_MOVES_PER_CARD = 20;

export interface RawMove {
  symbolId: string;
  /** Milisegundos desde el arranque de la partida (mismo reloj que ya usaba
      `totalMs`: `performance.now() - startAt`). */
  tMs: number;
}

export interface VerifiedScore {
  totalMs: number;
  averageMs: number;
  errors: number;
  accuracy: number;
}

export type ScoreVerifyResult =
  | { ok: true; score: VerifiedScore }
  | { ok: false; reason: string };

/** Generador con semilla para la carta `cardId` de esta partida. Un solo sitio
    define esta convención — cliente y servidor la comparten importándolo de
    aquí, así que nunca pueden desincronizarse por accidente. */
export function dailyCardRnd(seed: string, cardId: number): Rnd {
  return seededRnd(`daily:${seed}:card:${cardId}`);
}

function isPlausibleMove(m: unknown): m is RawMove {
  if (!m || typeof m !== "object") return false;
  const { symbolId, tMs } = m as Record<string, unknown>;
  return (
    typeof symbolId === "string" &&
    Boolean(SYMBOL_BY_ID[symbolId]) &&
    typeof tMs === "number" &&
    Number.isFinite(tMs) &&
    tMs >= 0
  );
}

/**
 * Rejuega la partida completa contra la semilla real y decide si el resultado
 * es posible. Si lo es, devuelve el tiempo/errores/precisión CALCULADOS por el
 * servidor — nunca los que mandó el cliente, que ya ni se leen.
 */
export function verifyScoreMoves(
  seed: string,
  deckSize: number,
  moves: unknown
): ScoreVerifyResult {
  if (!Array.isArray(moves) || moves.length === 0)
    return { ok: false, reason: "no_moves" };
  if (moves.length > deckSize * MAX_MOVES_PER_CARD)
    return { ok: false, reason: "too_many_moves" };

  const parsed: RawMove[] = [];
  for (const raw of moves) {
    if (!isPlausibleMove(raw)) return { ok: false, reason: "invalid_move" };
    parsed.push({ symbolId: raw.symbolId, tMs: Math.round(raw.tMs) });
  }

  // Nadie viaja al pasado: cada toque llega en el mismo instante o después
  // del anterior.
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].tMs < parsed[i - 1].tMs)
      return { ok: false, reason: "non_monotonic" };
  }

  let incoming = generateFirstCard(dailyCardRnd(seed, 1));
  let nextGen = generateNextCard(incoming, 2, dailyCardRnd(seed, 2));
  let nextId = 3;

  let correctCount = 0;
  let errors = 0;
  let lastCorrectMs = 0;
  let finished = false;

  for (const move of parsed) {
    if (finished) return { ok: false, reason: "moves_after_finish" };

    if (move.symbolId === nextGen.targetSymbolId) {
      const floor = correctCount === 0 ? MIN_MS_PER_CARD : lastCorrectMs + MIN_MS_PER_CARD;
      if (move.tMs < floor) return { ok: false, reason: "too_fast" };

      correctCount++;
      lastCorrectMs = move.tMs;

      if (correctCount === deckSize) {
        finished = true;
        continue;
      }

      incoming = nextGen.card;
      nextGen = generateNextCard(incoming, nextId, dailyCardRnd(seed, nextId));
      nextId++;
    } else {
      errors++;
    }
  }

  if (!finished) return { ok: false, reason: "incomplete" };

  const totalMs = lastCorrectMs + errors * ERROR_PENALTY_MS;
  return {
    ok: true,
    score: {
      totalMs,
      averageMs: Math.round(totalMs / deckSize),
      errors,
      accuracy: computeAccuracy(deckSize, errors),
    },
  };
}
