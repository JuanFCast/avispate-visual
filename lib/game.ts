import { SYMBOLS, SYMBOL_BY_ID, type Symbol } from "./symbols.ts";

export const DEFAULT_DECK_SIZE = 10;
export const DECK_OPTIONS = [10, 15, 20];
export const SYMBOLS_PER_CARD = 8;
export const ERROR_PENALTY_MS = 1000;

export interface PlacedSymbol {
  symbolId: string;
  /** Posición del centro del símbolo, en % del diámetro de la carta. */
  x: number;
  y: number;
  /** Rotación en grados. */
  rotation: number;
  /** Escala relativa del símbolo (varía para que no sea solo memoria visual). */
  scale: number;
}

/** Una carta de la cadena: la partida es un flujo continuo de cartas encadenadas. */
export interface ChainCard {
  id: number;
  symbols: PlacedSymbol[];
}

export interface GameResult {
  playerName: string;
  /** Tiempo total en gastar el mazo, penalizaciones incluidas. */
  totalMs: number;
  /** Tiempo promedio por carta: la métrica del ranking. */
  averageMs: number;
  /** Tamaño del mazo gastado. */
  cards: number;
  errors: number;
  /** Porcentaje de aciertos 0-100. */
  accuracy: number;
  createdAt: string;
}

/**
 * Fuente de azar. El reto diario usa `Math.random`; la Arena pasa un generador
 * con semilla para que los dos teléfonos dibujen la MISMA carta.
 */
export type Rnd = () => number;

function shuffle<T>(items: T[], rnd: Rnd = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Distribuye 8 símbolos dentro de la carta circular: 1 cerca del centro y 7 en
 * anillo, con jitter, rotación y tamaño aleatorios. Coordenadas en %.
 *
 * Con `rnd` sembrado el resultado es reproducible, que es lo que permite que en
 * la Arena una carta se vea igual en los dos dispositivos y siga viéndose igual
 * cuando pasa de ser tu carta a ser la base compartida.
 */
export function placeSymbols(
  symbolIds: string[],
  rnd: Rnd = Math.random
): PlacedSymbol[] {
  const ids = shuffle(symbolIds, rnd);
  const placed: PlacedSymbol[] = [];
  const angleOffset = rnd() * 360;
  const ringCount = ids.length - 1;

  // Símbolo central
  placed.push({
    symbolId: ids[0],
    x: 50 + (rnd() * 8 - 4),
    y: 50 + (rnd() * 8 - 4),
    rotation: rnd() * 70 - 35,
    scale: 0.85 + rnd() * 0.45,
  });

  // Anillo exterior
  for (let i = 0; i < ringCount; i++) {
    const angle = ((angleOffset + (360 / ringCount) * i) * Math.PI) / 180;
    const radius = 31 + rnd() * 5; // % del diámetro
    placed.push({
      symbolId: ids[i + 1],
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      rotation: rnd() * 70 - 35,
      scale: 0.85 + rnd() * 0.45,
    });
  }
  return placed;
}

/**
 * Primera carta base de la cadena: 8 símbolos únicos al azar.
 *
 * `rnd` es opcional y por defecto sigue siendo `Math.random` —el reto diario
 * de siempre—, pero cuando el servidor necesita rejugar la partida para
 * comprobar un puntaje (`lib/score-verify.ts`) le pasa un generador con
 * semilla, y el MISMO código produce el MISMO mazo. Ver `lib/arena-deck.ts`,
 * que ya usaba este patrón para la Arena.
 */
export function generateFirstCard(rnd: Rnd = Math.random): ChainCard {
  const pool = shuffle(SYMBOLS.map((s) => s.id), rnd).slice(0, SYMBOLS_PER_CARD);
  return { id: 1, symbols: placeSymbols(pool, rnd) };
}

/** Cuántos distractores buscan parecerse al objetivo. */
const MAX_SAME_COLOR = 4;
const MAX_SIMILAR = 6; // mismo color + misma categoría, combinados

/**
 * Genera la siguiente carta de la cadena: comparte exactamente 1 símbolo con
 * la carta base y los otros 7 no aparecen en ella.
 *
 * Los distractores se eligen para confundir: primero símbolos del mismo color
 * que el objetivo (si el común es la manzana, aparecen cosas rojas), luego de
 * la misma categoría, y el resto al azar.
 */
export function generateNextCard(
  base: ChainCard,
  id: number,
  rnd: Rnd = Math.random
): { card: ChainCard; targetSymbolId: string } {
  const baseIds = new Set(base.symbols.map((p) => p.symbolId));
  const targetId =
    base.symbols[Math.floor(rnd() * base.symbols.length)].symbolId;
  const target = SYMBOL_BY_ID[targetId];

  const available = SYMBOLS.filter(
    (s) => !baseIds.has(s.id) && s.id !== targetId
  );
  const sameColor = shuffle(
    available.filter((s) => s.color === target.color),
    rnd
  );
  const sameCategory = shuffle(
    available.filter(
      (s) => s.color !== target.color && s.category === target.category
    ),
    rnd
  );
  const rest = shuffle(
    available.filter(
      (s) => s.color !== target.color && s.category !== target.category
    ),
    rnd
  );

  const distractors: Symbol[] = [];
  for (const s of sameColor) {
    if (distractors.length >= MAX_SAME_COLOR) break;
    distractors.push(s);
  }
  for (const s of sameCategory) {
    if (distractors.length >= MAX_SIMILAR) break;
    distractors.push(s);
  }
  for (const s of rest) {
    if (distractors.length >= SYMBOLS_PER_CARD - 1) break;
    distractors.push(s);
  }
  // Si los grupos parecidos eran pequeños, completa con lo que quede.
  if (distractors.length < SYMBOLS_PER_CARD - 1) {
    const chosen = new Set(distractors.map((s) => s.id));
    for (const s of shuffle(available, rnd)) {
      if (distractors.length >= SYMBOLS_PER_CARD - 1) break;
      if (!chosen.has(s.id)) distractors.push(s);
    }
  }

  return {
    card: {
      id,
      symbols: placeSymbols([targetId, ...distractors.map((s) => s.id)], rnd),
    },
    targetSymbolId: targetId,
  };
}

export function computeAccuracy(correct: number, errors: number): number {
  const total = correct + errors;
  return total === 0 ? 100 : Math.round((correct / total) * 100);
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
