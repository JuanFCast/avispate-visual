import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readPot, settleDeck } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DECKS = [10, 15, 20];

/** Fecha de la ronda a liquidar por defecto: AYER (UTC), ya cerrada. */
function defaultRound(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

interface WinnerRow {
  profile_id: string;
  profiles: { wallet_address: string | null } | null;
}

/**
 * GET /api/cron/roll-day — liquida la ronda: por cada mazo, paga el pozo al #1
 * y lo reinicia. Protegido por CRON_SECRET (Vercel Cron lo envía como Bearer).
 * Idempotente por (round_date, deck) vía round_settlements.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const round = url.searchParams.get("date") ?? defaultRound();

  const db = getSupabaseAdmin();
  const results: Record<string, unknown>[] = [];

  for (const deck of DECKS) {
    // 1. ¿Ya liquidado?
    const { data: existing } = await db
      .from("round_settlements")
      .select("deck_size")
      .eq("round_date", round)
      .eq("deck_size", deck)
      .maybeSingle();
    if (existing) {
      results.push({ deck, skipped: "already_settled" });
      continue;
    }

    // 2. Sin fondos → no gastar gas en un tx que revertiría.
    const pot = await readPot(deck);
    if (pot === 0n) {
      results.push({ deck, skipped: "empty_pot" });
      continue;
    }

    // 3. Ganador: mejor marca del mazo en esa ronda.
    const { data: rows, error } = await db
      .from("scores")
      .select("profile_id, profiles!inner(wallet_address)")
      .eq("deck_size", deck)
      .eq("round_date", round)
      .order("average_ms", { ascending: true })
      .order("errors", { ascending: true })
      .limit(1);
    if (error) {
      results.push({ deck, error: "query_failed" });
      continue;
    }
    const top = (rows ?? [])[0] as unknown as WinnerRow | undefined;
    const winner = top?.profiles?.wallet_address ?? null;
    if (!top || !winner) {
      results.push({ deck, skipped: top ? "winner_no_wallet" : "no_players" });
      continue;
    }

    // 4. Liquidar on-chain y registrar.
    const settle = await settleDeck(deck, winner);
    if (!settle.ok) {
      results.push({ deck, error: settle.error });
      continue;
    }
    await db.from("round_settlements").insert({
      round_date: round,
      deck_size: deck,
      winner_profile_id: top.profile_id,
      winner_wallet: winner,
      tx_hash: settle.txHash,
      amount_units: pot.toString(),
    });
    results.push({ deck, winner, txHash: settle.txHash });
  }

  return NextResponse.json({ round, results });
}
