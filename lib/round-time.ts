/**
 * Reloj de la ronda. Es la ÚNICA definición de cuándo empieza y termina una
 * ronda, y la comparten el servidor (`/api/round`, cron) y el cliente.
 *
 * Una ronda va de 00:00 UTC a 00:00 UTC, es decir de 7:00 p. m. a 7:00 p. m.
 * en Colombia (UTC-5). La ronda "2026-07-26" cierra el 26 de julio a las
 * 7:00 p. m. hora de Colombia, así que su id coincide con la fecha colombiana
 * del cierre.
 *
 * Sin dependencias de React: se importa igual desde rutas `/api`.
 */

export const DAY_MS = 86_400_000;

/** Ronda abierta en ese instante, en formato YYYY-MM-DD. */
export function roundIdAt(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Instante de cierre (próximas 00:00 UTC) de la ronda abierta en `now`. El
 * epoch está alineado a medianoche UTC, así que basta truncar al día.
 */
export function roundClosesAt(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
}

/** Instante en que se abrió la ronda con ese id. */
export function roundOpensAt(roundId: string): number {
  return Date.parse(`${roundId}T00:00:00.000Z`);
}

/** Id de la ronda anterior a la dada. */
export function previousRoundId(roundId: string): string {
  return roundIdAt(roundOpensAt(roundId) - DAY_MS);
}

/* --------------------------- Formato del contador -------------------------- */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** HH:MM:SS, siempre con dos dígitos por campo. */
export function formatCountdown(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${pad(Math.floor(total / 3600))}:${pad(
    Math.floor((total % 3600) / 60)
  )}:${pad(total % 60)}`;
}

