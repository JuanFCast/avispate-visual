/**
 * Agregación del panel público de estadísticas (`/stats`).
 *
 * Todo lo de aquí son funciones PURAS sobre filas ya leídas: no tocan Supabase
 * ni la cadena. Así la ruta `/api/stats` se queda solo con la lectura y este
 * archivo se puede probar con datos de mentira (`node scripts/verify-stats.ts`).
 *
 * Unidades: los montos USDT viajan como STRING de unidades enteras (6 decimales
 * del token), nunca como número, para no perder precisión en JSON. Formatear es
 * cosa de la interfaz.
 *
 * El "día" de este panel es la RONDA (`round_date`, 00:00 UTC = 7:00 p. m. de
 * Colombia), no el día natural del visitante: es la misma unidad con la que el
 * juego reparte premios, así que las cifras cuadran con /historial.
 */

// Con extensión .ts a propósito: `scripts/verify-stats.ts` importa este archivo
// y lo ejecuta Node quitando los tipos, donde el import extensionless no
// resuelve. El bundler de Next resuelve la ruta explícita igual de bien.
import { DAY_MS, roundIdAt, roundOpensAt } from "./round-time.ts";

/* ------------------------------- Filas crudas ------------------------------ */

export interface StatsScoreRow {
  profile_id: string;
  round_date: string;
  deck_size: number;
  is_paid: boolean;
  average_ms: number;
  accuracy: number;
  errors: number;
  tx_hash: string | null;
}

export interface StatsProfileRow {
  id: string;
  created_at: string;
  privy_id: string | null;
  wallet_address: string | null;
}

export interface StatsSettlementRow {
  round_date: string;
  deck_size: number;
  amount_units: string | number | null;
  tx_hash: string | null;
  winner_wallet: string | null;
}

/** Lecturas on-chain; cualquiera puede ser null si el RPC falló. */
export interface ChainSnapshot {
  potsByDeck: Record<number, string | null>;
  feeUnits: string | null;
  commissionBps: number | null;
}

/* --------------------------------- Utilidades ------------------------------ */

/** Ronda desplazada `delta` días (negativo = hacia atrás). */
export function shiftRound(roundId: string, delta: number): string {
  return roundIdAt(roundOpensAt(roundId) + delta * DAY_MS);
}

/** Días entre dos rondas (b - a). Positivo si `b` es posterior. */
export function roundsBetween(a: string, b: string): number {
  return Math.round((roundOpensAt(b) - roundOpensAt(a)) / DAY_MS);
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function sumUnits(values: (string | number | null)[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + BigInt(v ?? 0), 0n);
}

/** Media entera de una lista; 0 si está vacía (no NaN, que rompe el JSON). */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/* --------------------------------- Secciones ------------------------------- */

export interface TodaySection {
  roundId: string;
  players: number;
  plays: number;
  paidPlays: number;
  freePlays: number;
  newPlayers: number;
}

/**
 * La ronda en curso. `newPlayers` sale de `profiles.created_at`, así que cuenta
 * a quien se registró hoy aunque todavía no haya jugado.
 */
export function buildToday(
  scores: StatsScoreRow[],
  profiles: StatsProfileRow[],
  today: string
): TodaySection {
  const rows = scores.filter((s) => s.round_date === today);
  const openedAt = roundOpensAt(today);
  return {
    roundId: today,
    players: new Set(rows.map((s) => s.profile_id)).size,
    plays: rows.length,
    paidPlays: rows.filter((s) => s.is_paid).length,
    freePlays: rows.filter((s) => !s.is_paid).length,
    newPlayers: profiles.filter((p) => Date.parse(p.created_at) >= openedAt)
      .length,
  };
}

export interface PlayersSection {
  total: number;
  withEmail: number;
  walletOnly: number;
  active7: number;
  active30: number;
  everPaid: number;
  paidConversionPct: number;
  /**
   * Cuántos jugadores han jugado 1, 2-5, 6-20 o 21+ partidas. `bucket` es un
   * código estable, no una etiqueta: el panel lo traduce al idioma de quien
   * mira, y el servidor no tiene por qué saber cuál es.
   */
  distribution: { bucket: PlaysBucket; players: number; pct: number }[];
}

export type PlaysBucket = "1" | "2_5" | "6_20" | "21";

export function buildPlayers(
  scores: StatsScoreRow[],
  profiles: StatsProfileRow[],
  today: string
): PlayersSection {
  const playsByProfile = new Map<string, number>();
  const paidProfiles = new Set<string>();
  const active7 = new Set<string>();
  const active30 = new Set<string>();
  const from7 = shiftRound(today, -6); // hoy incluido = 7 rondas
  const from30 = shiftRound(today, -29);

  for (const s of scores) {
    playsByProfile.set(s.profile_id, (playsByProfile.get(s.profile_id) ?? 0) + 1);
    if (s.is_paid) paidProfiles.add(s.profile_id);
    if (s.round_date >= from7) active7.add(s.profile_id);
    if (s.round_date >= from30) active30.add(s.profile_id);
  }

  const counts = [...playsByProfile.values()];
  const players = counts.length;
  const buckets: { bucket: PlaysBucket; test: (n: number) => boolean }[] = [
    { bucket: "1", test: (n) => n === 1 },
    { bucket: "2_5", test: (n) => n >= 2 && n <= 5 },
    { bucket: "6_20", test: (n) => n >= 6 && n <= 20 },
    { bucket: "21", test: (n) => n >= 21 },
  ];

  return {
    total: profiles.length,
    withEmail: profiles.filter((p) => p.privy_id).length,
    walletOnly: profiles.filter((p) => !p.privy_id && p.wallet_address).length,
    active7: active7.size,
    active30: active30.size,
    everPaid: paidProfiles.size,
    // Conversión sobre quien LLEGÓ A JUGAR, no sobre los registrados: mide la
    // decisión de pagar, no la de crear cuenta.
    paidConversionPct: pct(paidProfiles.size, players),
    distribution: buckets.map((b) => {
      const n = counts.filter(b.test).length;
      return { bucket: b.bucket, players: n, pct: pct(n, players) };
    }),
  };
}

/** Ventana de retención. Código estable; el panel pone el texto. */
export type RetentionWindow = "d1" | "d7" | "d30";

export interface RetentionRow {
  window: RetentionWindow;
  /** Jugadores que ya tuvieron tiempo de volver en esa ventana. */
  eligible: number;
  returned: number;
  pct: number;
}

/**
 * Retención por ventanas: de los que estrenaron hace al menos N días, cuántos
 * volvieron a jugar DENTRO de esos N días (no exactamente el día N).
 *
 * Solo entra al denominador quien ya tuvo la oportunidad completa: alguien que
 * estrenó ayer no puede contar todavía para la ventana de 7 días, o el
 * porcentaje saldría artificialmente bajo.
 */
export function buildRetention(
  scores: StatsScoreRow[],
  today: string
): RetentionRow[] {
  const daysByProfile = new Map<string, Set<string>>();
  for (const s of scores) {
    const set = daysByProfile.get(s.profile_id) ?? new Set<string>();
    set.add(s.round_date);
    daysByProfile.set(s.profile_id, set);
  }

  const players = [...daysByProfile.entries()].map(([id, days]) => {
    const sorted = [...days].sort();
    return { id, first: sorted[0], days: sorted };
  });

  const windows: { window: RetentionWindow; n: number }[] = [
    { window: "d1", n: 1 },
    { window: "d7", n: 7 },
    { window: "d30", n: 30 },
  ];

  return windows.map(({ window, n }) => {
    const eligible = players.filter((p) => roundsBetween(p.first, today) >= n);
    const returned = eligible.filter((p) =>
      p.days.some((d) => {
        const gap = roundsBetween(p.first, d);
        return gap > 0 && gap <= n;
      })
    );
    return {
      window,
      eligible: eligible.length,
      returned: returned.length,
      pct: pct(returned.length, eligible.length),
    };
  });
}

export interface TrendPoint {
  roundId: string;
  plays: number;
  paidPlays: number;
  players: number;
}

/** Partidas por ronda de los últimos `days` días, del más viejo al más nuevo. */
export function buildTrend(
  scores: StatsScoreRow[],
  today: string,
  days = 30
): TrendPoint[] {
  const byDay = new Map<string, StatsScoreRow[]>();
  for (const s of scores) {
    const list = byDay.get(s.round_date) ?? [];
    list.push(s);
    byDay.set(s.round_date, list);
  }
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const roundId = shiftRound(today, -i);
    const rows = byDay.get(roundId) ?? [];
    points.push({
      roundId,
      plays: rows.length,
      paidPlays: rows.filter((r) => r.is_paid).length,
      players: new Set(rows.map((r) => r.profile_id)).size,
    });
  }
  return points;
}

export interface PlaysSection {
  total: number;
  paid: number;
  free: number;
  /** Promedio por carta de TODAS las partidas, en ms. */
  averageMs: number;
  /** La mejor marca registrada (menor promedio por carta), en ms. */
  bestAverageMs: number | null;
  accuracyPct: number;
  trend: TrendPoint[];
}

export function buildPlays(
  scores: StatsScoreRow[],
  today: string
): PlaysSection {
  return {
    total: scores.length,
    paid: scores.filter((s) => s.is_paid).length,
    free: scores.filter((s) => !s.is_paid).length,
    averageMs: mean(scores.map((s) => s.average_ms)),
    bestAverageMs:
      scores.length > 0
        ? Math.min(...scores.map((s) => s.average_ms))
        : null,
    accuracyPct: mean(scores.map((s) => s.accuracy)),
    trend: buildTrend(scores, today),
  };
}

export interface DeckRow {
  deck: number;
  plays: number;
  players: number;
  bestAverageMs: number | null;
  /** Pozo vivo on-chain; null si no se pudo leer la cadena. */
  potUnits: string | null;
  paidOutUnits: string;
  roundsPlayed: number;
  roundsWon: number;
}

/** Una fila por mazo: es la comparativa "por juego" de este proyecto. */
export function buildDecks(
  scores: StatsScoreRow[],
  settlements: StatsSettlementRow[],
  chain: ChainSnapshot,
  decks: number[]
): DeckRow[] {
  return decks.map((deck) => {
    const rows = scores.filter((s) => s.deck_size === deck);
    const paidSettlements = settlements.filter(
      (s) => s.deck_size === deck && s.tx_hash
    );
    return {
      deck,
      plays: rows.length,
      players: new Set(rows.map((r) => r.profile_id)).size,
      bestAverageMs:
        rows.length > 0 ? Math.min(...rows.map((r) => r.average_ms)) : null,
      potUnits: chain.potsByDeck[deck] ?? null,
      paidOutUnits: sumUnits(paidSettlements.map((s) => s.amount_units)).toString(),
      roundsPlayed: new Set(rows.map((r) => r.round_date)).size,
      roundsWon: paidSettlements.length,
    };
  });
}

export interface EconomySection {
  /** Tarifa por jugada paga leída del contrato (unidades USDT). */
  feeUnits: string | null;
  commissionBps: number | null;
  /** Recaudado = jugadas pagas × tarifa ACTUAL. Estimado, ver nota en la UI. */
  revenueUnits: string | null;
  toPotUnits: string | null;
  commissionUnits: string | null;
  /** Premios efectivamente pagados (con tx en la cadena). */
  paidOutUnits: string;
  pendingUnits: string;
  biggestPrizeUnits: string | null;
  livePotUnits: string | null;
  roundsSettled: number;
  roundsWithWinner: number;
  rollovers: number;
}

export function buildEconomy(
  scores: StatsScoreRow[],
  settlements: StatsSettlementRow[],
  chain: ChainSnapshot
): EconomySection {
  const paidPlays = scores.filter((s) => s.is_paid).length;
  const fee = chain.feeUnits === null ? null : BigInt(chain.feeUnits);
  const bps = chain.commissionBps;

  const revenue = fee === null ? null : fee * BigInt(paidPlays);
  const commission =
    revenue === null || bps === null ? null : (revenue * BigInt(bps)) / 10_000n;
  const toPot =
    revenue === null || commission === null ? null : revenue - commission;

  const paid = settlements.filter((s) => s.tx_hash);
  const pending = settlements.filter((s) => !s.tx_hash && s.winner_wallet);
  const amounts = paid
    .map((s) => BigInt(s.amount_units ?? 0))
    .filter((v) => v > 0n);

  const pots = Object.values(chain.potsByDeck);
  const livePot = pots.some((p) => p === null)
    ? null
    : sumUnits(pots as string[]).toString();

  return {
    feeUnits: chain.feeUnits,
    commissionBps: bps,
    revenueUnits: revenue === null ? null : revenue.toString(),
    toPotUnits: toPot === null ? null : toPot.toString(),
    commissionUnits: commission === null ? null : commission.toString(),
    paidOutUnits: sumUnits(paid.map((s) => s.amount_units)).toString(),
    pendingUnits: sumUnits(pending.map((s) => s.amount_units)).toString(),
    biggestPrizeUnits:
      amounts.length > 0
        ? amounts.reduce((a, b) => (b > a ? b : a)).toString()
        : null,
    livePotUnits: livePot,
    roundsSettled: settlements.length,
    roundsWithWinner: settlements.filter((s) => s.winner_wallet).length,
    rollovers: settlements.filter((s) => !s.winner_wallet).length,
  };
}

export interface ChainSection {
  potAddress: string | null;
  playTxs: number;
  prizeTxs: number;
  wallets: number;
  welcomeGasCount: number;
  welcomeGasWei: string;
}

export interface StatsPayload {
  generatedAt: string;
  today: TodaySection;
  players: PlayersSection;
  retention: RetentionRow[];
  plays: PlaysSection;
  decks: DeckRow[];
  economy: EconomySection;
  chain: ChainSection;
  /** Se alcanzó el tope de filas leídas: las cifras son de la ventana reciente. */
  truncated: boolean;
}
