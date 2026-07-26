import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

interface SettlementRow {
  round_date: string;
  deck_size: number;
  winner_profile_id: string | null;
  winner_wallet: string | null;
  amount_units: number | string | null;
  tx_hash: string | null;
  profiles: { alias: string | null } | null;
}

interface ScoreRow {
  profile_id: string;
  deck_size: number;
  round_date: string;
  average_ms: number;
  errors: number;
}

/** Nunca sale de aquí una dirección completa ni un correo. */
function shorten(address: string | null): string | null {
  if (!address) return null;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function key(round: string, deck: number, profile: string): string {
  return `${round}|${deck}|${profile}`;
}

/**
 * GET /api/history?limit=15&offset=0 — historial PÚBLICO de rondas cerradas:
 * quién ganó cada mazo, cuánto se llevó y cómo quedó el pago.
 *
 * Lee `round_settlements`, que es el registro persistido de la liquidación; no
 * recalcula ganadores desde el ranking vivo. Sin sesión: cualquiera puede
 * consultarlo. El orden (fecha desc, mazo asc) es la clave primaria de la
 * tabla, así que la paginación es estable y no duplica ni salta filas.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number(params.get("offset")) || 0);

  try {
    const db = getSupabaseAdmin();
    // Se pide una fila de más para saber si hay página siguiente sin contar.
    const { data, error } = await db
      .from("round_settlements")
      .select(
        "round_date, deck_size, winner_profile_id, winner_wallet, amount_units, tx_hash, profiles(alias)"
      )
      .order("round_date", { ascending: false })
      .order("deck_size", { ascending: true })
      .range(offset, offset + limit);
    if (error) throw error;

    const all = (data ?? []) as unknown as SettlementRow[];
    const hasMore = all.length > limit;
    const rows = hasMore ? all.slice(0, limit) : all;

    // Marca con la que el ganador se llevó el pozo: es la métrica que decide
    // el ranking (menor promedio por carta), leída de su partida de esa ronda.
    const winners = rows.filter((r) => r.winner_profile_id);
    const scores = new Map<string, ScoreRow>();
    if (winners.length > 0) {
      const { data: scoreData } = await db
        .from("scores")
        .select("profile_id, deck_size, round_date, average_ms, errors")
        .in("round_date", [...new Set(winners.map((r) => r.round_date))])
        .in("profile_id", [
          ...new Set(winners.map((r) => r.winner_profile_id as string)),
        ])
        .order("average_ms", { ascending: true });
      for (const s of (scoreData ?? []) as ScoreRow[]) {
        // Ordenado de mejor a peor: la primera de cada combinación es la buena.
        const k = key(s.round_date, s.deck_size, s.profile_id);
        if (!scores.has(k)) scores.set(k, s);
      }
    }

    const history = rows.map((r) => {
      const score = r.winner_profile_id
        ? scores.get(key(r.round_date, r.deck_size, r.winner_profile_id))
        : undefined;
      return {
        roundDate: r.round_date,
        deck: r.deck_size,
        prizeUnits: r.amount_units === null ? null : String(r.amount_units),
        winnerAlias: r.profiles?.alias ?? null,
        winnerWallet: shorten(r.winner_wallet),
        averageMs: score?.average_ms ?? null,
        errors: score?.errors ?? null,
        txHash: r.tx_hash,
        // El estado se refleja, no se asume: una ronda puede quedar sin
        // ganador (el pozo rueda) o con el pago aún sin confirmar.
        payout: r.tx_hash
          ? ("paid" as const)
          : r.winner_wallet
            ? ("pending" as const)
            : ("rollover" as const),
      };
    });

    return NextResponse.json(
      { history, hasMore },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
