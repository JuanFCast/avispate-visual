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

/** Zona con la que se rotula el cierre en la interfaz. */
export const ROUND_TZ = "America/Bogota";

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

/**
 * Las cuatro palabras que este módulo necesita traducidas. Van aquí y no en
 * `lib/i18n` a propósito: `round-time.ts` lo importan las rutas `/api` y los
 * scripts de `scripts/` con Node pelado, y tiene que seguir sin dependencias.
 */
type HintLang = "en" | "es";

const HINT_COPY: Record<
  HintLang,
  { locale: string; today: string; tomorrow: string; yourZone: string }
> = {
  en: {
    locale: "en-US",
    today: "Today",
    tomorrow: "Tomorrow",
    yourZone: "your time",
  },
  es: {
    locale: "es-CO",
    today: "Hoy",
    tomorrow: "Mañana",
    yourZone: "en tu zona",
  },
};

/** Hora de pared del instante `ms` en `timeZone` (la local si se omite). */
function timeIn(ms: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(ms));
}

function dayIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(ms));
}

/**
 * Texto secundario del cierre: la hora de Colombia y, si el visitante está en
 * otra zona, su equivalencia local. Es SOLO informativo — quién alcanzó a
 * entrar lo decide `closesAt`, que es el mismo instante universal para todos.
 *
 * `localTz` existe para poder probar zonas distintas sin depender del reloj
 * del sistema; en la app se omite y manda la zona del navegador.
 */
export function closeHintFor(
  closesAtMs: number,
  nowMs: number,
  lang: HintLang = "en",
  localTz?: string
): string {
  const copy = HINT_COPY[lang] ?? HINT_COPY.en;
  const colombia = timeIn(closesAtMs, copy.locale, ROUND_TZ);
  const when =
    dayIn(closesAtMs, ROUND_TZ) === dayIn(nowMs, ROUND_TZ)
      ? copy.today
      : copy.tomorrow;
  let local: string;
  try {
    local = timeIn(closesAtMs, copy.locale, localTz);
  } catch {
    return `${when}, ${colombia} (Colombia)`;
  }
  // Misma hora de pared que Colombia: no hay nada que traducir.
  if (local === colombia) return `${when}, ${colombia} (Colombia)`;
  return `${colombia} Colombia · ${local} ${copy.yourZone}`;
}
