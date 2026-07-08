import { SYMBOLS } from "./symbols";

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

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Distribuye 8 símbolos dentro de la carta circular: 1 cerca del centro y 7 en
 * anillo, con jitter, rotación y tamaño aleatorios. Coordenadas en %.
 */
function placeSymbols(symbolIds: string[]): PlacedSymbol[] {
  const ids = shuffle(symbolIds);
  const placed: PlacedSymbol[] = [];
  const angleOffset = Math.random() * 360;
  const ringCount = ids.length - 1;

  // Símbolo central
  placed.push({
    symbolId: ids[0],
    x: 50 + (Math.random() * 8 - 4),
    y: 50 + (Math.random() * 8 - 4),
    rotation: Math.random() * 70 - 35,
    scale: 0.85 + Math.random() * 0.45,
  });

  // Anillo exterior
  for (let i = 0; i < ringCount; i++) {
    const angle = ((angleOffset + (360 / ringCount) * i) * Math.PI) / 180;
    const radius = 31 + Math.random() * 5; // % del diámetro
    placed.push({
      symbolId: ids[i + 1],
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      rotation: Math.random() * 70 - 35,
      scale: 0.85 + Math.random() * 0.45,
    });
  }
  return placed;
}

/** Primera carta base de la cadena: 8 símbolos únicos al azar. */
export function generateFirstCard(): ChainCard {
  const pool = shuffle(SYMBOLS.map((s) => s.id)).slice(0, SYMBOLS_PER_CARD);
  return { id: 1, symbols: placeSymbols(pool) };
}

/**
 * Genera la siguiente carta de la cadena: comparte exactamente 1 símbolo con
 * la carta base y los otros 7 no aparecen en ella.
 */
export function generateNextCard(
  base: ChainCard,
  id: number
): { card: ChainCard; targetSymbolId: string } {
  const baseIds = base.symbols.map((p) => p.symbolId);
  const target = baseIds[Math.floor(Math.random() * baseIds.length)];
  const others = shuffle(
    SYMBOLS.map((s) => s.id).filter((sid) => !baseIds.includes(sid))
  ).slice(0, SYMBOLS_PER_CARD - 1);
  return {
    card: { id, symbols: placeSymbols([target, ...others]) },
    targetSymbolId: target,
  };
}

export function computeAccuracy(correct: number, errors: number): number {
  const total = correct + errors;
  return total === 0 ? 100 : Math.round((correct / total) * 100);
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
