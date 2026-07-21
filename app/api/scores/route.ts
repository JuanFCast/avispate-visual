import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { ensureProfile } from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

/** POST: registra una partida terminada. Idempotente por `clientGameId`. */
export async function POST(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { clientGameId, deckSize, totalMs, averageMs, errors, accuracy } = body;

  // Validación en el servidor: no confiamos en el cliente.
  if (typeof clientGameId !== "string" || !UUID_RE.test(clientGameId))
    return NextResponse.json({ error: "invalid_client_game_id" }, { status: 400 });
  if (!DECK_SIZES.includes(deckSize))
    return NextResponse.json({ error: "invalid_deck_size" }, { status: 400 });
  if (!isInt(totalMs) || totalMs < 0 || !isInt(averageMs) || averageMs < 0)
    return NextResponse.json({ error: "invalid_time" }, { status: 400 });
  if (!isInt(errors) || errors < 0)
    return NextResponse.json({ error: "invalid_errors" }, { status: 400 });
  if (!isInt(accuracy) || accuracy < 0 || accuracy > 100)
    return NextResponse.json({ error: "invalid_accuracy" }, { status: 400 });

  try {
    const profile = await ensureProfile(auth.identity);
    if (!profile.alias) {
      // El alias es obligatorio antes de entrar al ranking.
      return NextResponse.json({ error: "alias_required" }, { status: 409 });
    }

    const db = getSupabaseAdmin();
    // onConflict + ignoreDuplicates: un reintento con el mismo clientGameId no
    // crea una fila duplicada.
    const { error } = await db.from("scores").upsert(
      {
        profile_id: profile.id,
        client_game_id: clientGameId,
        deck_size: deckSize,
        total_ms: totalMs,
        average_ms: averageMs,
        errors,
        accuracy,
      },
      { onConflict: "client_game_id", ignoreDuplicates: true }
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
