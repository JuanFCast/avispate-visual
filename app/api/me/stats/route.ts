import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/http";
import { verifyPrivyToken } from "@/lib/privy-server";
import { ensureProfile } from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { roundIdAt } from "@/lib/round-time";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-f]{40}$/i;

interface PrizeRow {
  round_date: string;
  deck_size: number;
  amount_units: number | string | null;
  tx_hash: string | null;
}

interface ArenaPrizeRow {
  prize_units: number | string | null;
  tx_hash: string | null;
  confirmed_at: string | null;
  created_at: string;
}

interface PlayerRef {
  id: string;
  wallet: string | null;
}

/** Identifica al jugador por token de Privy (correo) o por ?wallet= (solo-wallet). */
async function resolveProfile(req: Request): Promise<PlayerRef | null> {
  const token = bearerToken(req);
  if (token) {
    try {
      const identity = await verifyPrivyToken(token);
      const profile = await ensureProfile(identity);
      return { id: profile.id, wallet: profile.wallet_address };
    } catch {
      return null;
    }
  }
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (wallet && ADDR_RE.test(wallet)) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("profiles")
      .select("id, wallet_address")
      .eq("wallet_address", wallet.toLowerCase())
      .maybeSingle();
    return data ? { id: data.id, wallet: data.wallet_address } : null;
  }
  return null;
}

/**
 * GET /api/me/stats — estadísticas REALES del jugador: partidas jugadas (reto
 * diario + Arena), victorias y total ganado en USDT + historial de premios.
 *
 * Los premios salen de DOS tablas, una por juego: `round_settlements` (pozo
 * del reto diario) y `arena_settlements` (pozo de una mesa de Arena). Solo se
 * leía la primera, así que quien ganaba una mesa paga veía el dinero en su
 * wallet y un perfil con "0 victorias". Las dos cuentan solo lo ya pagado
 * (`tx_hash` no nulo): un premio decidido y no confirmado aún no es suyo.
 *
 * Una victoria es un premio cobrado. Las mesas gratis de la Arena no suman:
 * son de práctica y no tienen liquidación.
 */
export async function GET(req: Request) {
  const empty = { gamesPlayed: 0, wins: 0, totalWonUnits: "0", prizes: [] };
  const player = await resolveProfile(req);
  if (!player) return NextResponse.json(empty);

  try {
    const db = getSupabaseAdmin();
    // En la Arena manda la dirección: es a quien le pagó el contrato
    // (`arena_settlements.winner_address`). El perfil se mira también, por si
    // la wallet del perfil cambió después de cobrar.
    const arenaWinner = player.wallet
      ? `winner_profile_id.eq.${player.id},winner_address.eq.${player.wallet.toLowerCase()}`
      : `winner_profile_id.eq.${player.id}`;

    const [games, arenaGames, prizesRes, arenaRes] = await Promise.all([
      db
        .from("scores")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", player.id),
      db
        .from("arena_match_players")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", player.id),
      db
        .from("round_settlements")
        .select("round_date, deck_size, amount_units, tx_hash")
        .eq("winner_profile_id", player.id)
        .not("tx_hash", "is", null)
        .order("round_date", { ascending: false }),
      db
        .from("arena_settlements")
        .select("prize_units, tx_hash, confirmed_at, created_at")
        .or(arenaWinner)
        .not("tx_hash", "is", null),
    ]);
    // Una tabla que falla no puede convertirse en "0 premios" en silencio:
    // mejor el vacío de siempre que un total a medias.
    if (prizesRes.error || arenaRes.error) throw prizesRes.error ?? arenaRes.error;

    const daily = ((prizesRes.data ?? []) as PrizeRow[]).map((p) => ({
      kind: "daily" as const,
      roundDate: p.round_date,
      deck: p.deck_size,
      amountUnits: String(p.amount_units ?? "0"),
      txHash: p.tx_hash,
    }));
    const arena = ((arenaRes.data ?? []) as ArenaPrizeRow[]).map((p) => ({
      kind: "arena" as const,
      // Mismo formato que la ronda (fecha UTC) para que la lista se ordene y
      // se pinte igual.
      roundDate: roundIdAt(Date.parse(p.confirmed_at ?? p.created_at)),
      deck: null,
      amountUnits: String(p.prize_units ?? "0"),
      txHash: p.tx_hash,
    }));
    const prizes = [...daily, ...arena].sort((a, b) =>
      b.roundDate.localeCompare(a.roundDate)
    );
    const totalWon = prizes.reduce(
      (sum, p) => sum + BigInt(p.amountUnits),
      0n
    );

    return NextResponse.json({
      gamesPlayed: (games.count ?? 0) + (arenaGames.count ?? 0),
      wins: prizes.length,
      totalWonUnits: totalWon.toString(),
      prizes,
    });
  } catch {
    return NextResponse.json(empty);
  }
}
