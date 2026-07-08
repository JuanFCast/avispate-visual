import type { GameResult } from "./game";

// v3: el modo individual es gastar el mazo en el menor tiempo posible.
const STORAGE_KEY = "visualRushLeaderboard_v3";
const MAX_ENTRIES = 20;

/**
 * Menor tiempo promedio por carta primero (comparable entre mazos de distinto
 * tamaño); si empatan, menos errores y luego menor tiempo total.
 */
export function sortResults(results: GameResult[]): GameResult[] {
  return [...results].sort(
    (a, b) =>
      a.averageMs - b.averageMs || a.errors - b.errors || a.totalMs - b.totalMs
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
