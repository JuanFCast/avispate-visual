import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];
const TOP_N = 20;

interface ScoreJoinRow {
  profile_id: string;
  average_ms: number;
  errors: number;
  total_ms: number;
  profiles: { alias: string | null; wallet_address: string | null } | null;
}

/**
 * GET /api/leaderboard?deck=10 — ranking público: el MEJOR resultado de cada
 * jugador para ese tamaño de mazo (menor promedio; a igualdad, menos errores).
 * Lectura pública, no requiere sesión.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const deck = Number(url.searchParams.get("deck") ?? 10);
  if (!DECK_SIZES.includes(deck)) {
    return NextResponse.json({ error: "invalid_deck_size" }, { status: 400 });
  }

  try {
    const db = getSupabaseAdmin();
    // Traemos las partidas de ese mazo ya ordenadas de mejor a peor y nos
    // quedamos con la primera de cada jugador (su mejor marca).
    const { data, error } = await db
      .from("scores")
      .select("profile_id, average_ms, errors, total_ms, profiles!inner(alias, wallet_address)")
      .eq("deck_size", deck)
      .order("average_ms", { ascending: true })
      .order("errors", { ascending: true })
      .limit(1000);
    if (error) throw error;

    const rows = (data ?? []) as unknown as ScoreJoinRow[];
    const seen = new Set<string>();
    const leaderboard = [];
    for (const row of rows) {
      if (seen.has(row.profile_id)) continue;
      seen.add(row.profile_id);
      leaderboard.push({
        alias: row.profiles?.alias ?? "—",
        walletAddress: row.profiles?.wallet_address ?? null,
        averageMs: row.average_ms,
        errors: row.errors,
        totalMs: row.total_ms,
      });
      if (leaderboard.length >= TOP_N) break;
    }

    return NextResponse.json({ deck, leaderboard });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
