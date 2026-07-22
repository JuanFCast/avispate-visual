import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/http";
import { verifyPrivyToken } from "@/lib/privy-server";
import { ensureProfile } from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-f]{40}$/i;

interface PrizeRow {
  round_date: string;
  deck_size: number;
  amount_units: number | string | null;
  tx_hash: string | null;
}

/** Identifica al jugador por token de Privy (correo) o por ?wallet= (solo-wallet). */
async function resolveProfileId(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (token) {
    try {
      const identity = await verifyPrivyToken(token);
      const profile = await ensureProfile(identity);
      return profile.id;
    } catch {
      return null;
    }
  }
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (wallet && ADDR_RE.test(wallet)) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("profiles")
      .select("id")
      .eq("wallet_address", wallet.toLowerCase())
      .maybeSingle();
    return data?.id ?? null;
  }
  return null;
}

/**
 * GET /api/me/stats — estadísticas REALES del jugador: partidas jugadas
 * (scores), victorias y total ganado en USDT + historial de premios
 * (round_settlements ya pagados, con tx_hash).
 */
export async function GET(req: Request) {
  const empty = { gamesPlayed: 0, wins: 0, totalWonUnits: "0", prizes: [] };
  const profileId = await resolveProfileId(req);
  if (!profileId) return NextResponse.json(empty);

  try {
    const db = getSupabaseAdmin();
    const [games, prizesRes] = await Promise.all([
      db
        .from("scores")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profileId),
      db
        .from("round_settlements")
        .select("round_date, deck_size, amount_units, tx_hash")
        .eq("winner_profile_id", profileId)
        .not("tx_hash", "is", null)
        .order("round_date", { ascending: false }),
    ]);

    const prizes = (prizesRes.data ?? []) as PrizeRow[];
    const totalWon = prizes.reduce(
      (sum, p) => sum + BigInt(p.amount_units ?? 0),
      0n
    );

    return NextResponse.json({
      gamesPlayed: games.count ?? 0,
      wins: prizes.length,
      totalWonUnits: totalWon.toString(),
      prizes: prizes.map((p) => ({
        roundDate: p.round_date,
        deck: p.deck_size,
        amountUnits: String(p.amount_units ?? "0"),
        txHash: p.tx_hash,
      })),
    });
  } catch {
    return NextResponse.json(empty);
  }
}
