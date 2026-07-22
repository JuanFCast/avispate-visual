import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/http";
import { verifyPrivyToken } from "@/lib/privy-server";
import { ensureProfile } from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DECKS = [10, 15, 20];

function currentRound(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * GET /api/entitlement — para el usuario Privy, dice qué mazos aún tienen su
 * jugada GRATIS de hoy. Sin sesión Privy: no hay gratis (todo se paga).
 */
export async function GET(req: Request) {
  const none = Object.fromEntries(DECKS.map((d) => [d, false]));

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ free: none });

  try {
    const identity = await verifyPrivyToken(token);
    const profile = await ensureProfile(identity);
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("scores")
      .select("deck_size")
      .eq("profile_id", profile.id)
      .eq("round_date", currentRound())
      .eq("is_paid", false);
    if (error) throw error;

    const used = new Set((data ?? []).map((r) => r.deck_size));
    const free = Object.fromEntries(DECKS.map((d) => [d, !used.has(d)]));
    return NextResponse.json({ free });
  } catch {
    // Ante cualquier fallo, lo seguro es cobrar (no regalar jugadas).
    return NextResponse.json({ free: none });
  }
}
