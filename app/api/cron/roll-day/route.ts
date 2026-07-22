import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readPot, settleDeck } from "@/lib/settle";
import { seedPotFromFunder } from "@/lib/seed";

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
    // 1. ¿Ya procesada esta ronda+mazo? (settle + resiembra ya hechos)
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

    const pot = await readPot(deck);
    let winner: string | null = null;
    let winnerProfileId: string | null = null;
    let settleTx: string | undefined;

    // 2. Liquidar la ronda si hay fondos y un ganador con wallet.
    if (pot > 0n) {
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
        continue; // sin registrar → reintenta la próxima corrida
      }
      const top = (rows ?? [])[0] as unknown as WinnerRow | undefined;
      winner = top?.profiles?.wallet_address ?? null;
      winnerProfileId = top?.profile_id ?? null;

      if (winner) {
        const settle = await settleDeck(deck, winner);
        if (!settle.ok) {
          results.push({ deck, error: settle.error });
          continue; // no registrar → reintenta
        }
        settleTx = settle.txHash;
      }
      // pot>0 sin ganador con wallet: se deja rodar al siguiente día.
    }

    // 3. Resembrar el pozo del NUEVO día desde el Funder.
    const seed = await seedPotFromFunder(deck);

    // 4. Registrar la transición (idempotencia por ronda+mazo).
    await db.from("round_settlements").insert({
      round_date: round,
      deck_size: deck,
      winner_profile_id: winnerProfileId,
      winner_wallet: winner,
      tx_hash: settleTx,
      amount_units: pot > 0n ? pot.toString() : null,
    });
    results.push({
      deck,
      winner,
      settleTx: settleTx ?? null,
      reseeded: seed.ok,
      seedError: seed.ok ? undefined : seed.error,
    });
  }

  return NextResponse.json({ round, results });
}
