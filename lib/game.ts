import { SYMBOLS } from "./symbols";

export const DEFAULT_ROUNDS = 10;
export const ROUND_OPTIONS = [10, 15, 20];
export const SYMBOLS_PER_CARD = 8;
export const ERROR_PENALTY_MS = 1000;
export const POINTS_CORRECT = 100;
export const POINTS_ERROR = -20;

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

export interface Round {
  id: number;
  cardA: PlacedSymbol[];
  cardB: PlacedSymbol[];
  targetSymbolId: string;
}

export interface GameResult {
  playerName: string;
  score: number;
  totalMs: number;
  averageMs: number;
  correct: number;
  errors: number;
  maxStreak: number;
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

/**
 * Genera las rondas de una partida. Regla simple y confiable: 1 símbolo común
 * al azar + 7 distractores únicos por carta, sin repetir distractores entre
 * las dos cartas.
 */
export function generateRounds(count: number): Round[] {
  const rounds: Round[] = [];
  for (let r = 0; r < count; r++) {
    const pool = shuffle(SYMBOLS.map((s) => s.id));
    const target = pool[0];
    const distractorsA = pool.slice(1, SYMBOLS_PER_CARD);
    const distractorsB = pool.slice(SYMBOLS_PER_CARD, SYMBOLS_PER_CARD * 2 - 1);
    rounds.push({
      id: r + 1,
      cardA: placeSymbols([target, ...distractorsA]),
      cardB: placeSymbols([target, ...distractorsB]),
      targetSymbolId: target,
    });
  }
  return rounds;
}

/**
 * Puntaje final: 1000 - promedioMs/10 - errores*50 + rachaMax*25 (nunca negativo).
 */
export function computeScore(
  totalMs: number,
  rounds: number,
  errors: number,
  maxStreak: number
): number {
  const averageMs = totalMs / Math.max(1, rounds);
  return Math.max(
    0,
    Math.round(1000 - averageMs / 10 - errors * 50 + maxStreak * 25)
  );
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
