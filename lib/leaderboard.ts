import type { GameResult } from "./game";

// v2: el modo individual pasó de rondas fijas a cadena continua contrarreloj.
const STORAGE_KEY = "visualRushLeaderboard_v2";
const MAX_ENTRIES = 20;

/** Más puntos primero; si empatan, mayor precisión y luego más aciertos. */
export function sortResults(results: GameResult[]): GameResult[] {
  return [...results].sort(
    (a, b) =>
      b.score - a.score || b.accuracy - a.accuracy || b.correct - a.correct
  );
}

export function loadLeaderboard(): GameResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortResults(parsed);
  } catch {
    return [];
  }
}

/** Guarda el resultado y devuelve el ranking actualizado y la posición (1-based, -1 si quedó fuera). */
export function saveResult(result: GameResult): {
  leaderboard: GameResult[];
  position: number;
} {
  const merged = sortResults([...loadLeaderboard(), result]).slice(
    0,
    MAX_ENTRIES
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage lleno o bloqueado: el juego sigue funcionando sin persistir.
  }
  const position = merged.findIndex(
    (r) => r.createdAt === result.createdAt && r.playerName === result.playerName
  );
  return { leaderboard: merged, position: position === -1 ? -1 : position + 1 };
}
