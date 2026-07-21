import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { ensureProfile } from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { validateAlias } from "@/lib/alias";

export const dynamic = "force-dynamic";

/** GET: asegura que el perfil exista y devuelve alias + wallet del jugador. */
export async function GET(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  try {
    const profile = await ensureProfile(auth.identity);
    return NextResponse.json({
      alias: profile.alias,
      walletAddress: profile.wallet_address,
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/** POST: fija/actualiza el alias del jugador (obligatorio para el ranking). */
export async function POST(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const check = validateAlias(body?.alias ?? "");
  if (!check.ok || !check.value) {
    return NextResponse.json({ error: check.error ?? "invalid_alias" }, { status: 400 });
  }

  try {
    const profile = await ensureProfile(auth.identity);
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("profiles")
      .update({ alias: check.value })
      .eq("id", profile.id)
      .select("alias")
      .single();

    if (error) {
      // 23505 = violación de índice único (alias ya tomado por otro jugador).
      if (error.code === "23505") {
        return NextResponse.json({ error: "alias_taken" }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ alias: data.alias });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
