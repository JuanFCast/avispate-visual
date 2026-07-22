import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { validateAlias } from "@/lib/alias";

export const dynamic = "force-dynamic";

/**
 * GET /api/alias-available?alias=Pipe — dice si un alias está libre (sin
 * distinguir mayúsculas). Lectura pública; sirve para avisar ANTES de jugar.
 * La unicidad definitiva la reimpone el servidor al guardar el puntaje.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const check = validateAlias(url.searchParams.get("alias") ?? "");
  if (!check.ok || !check.value) {
    return NextResponse.json({
      available: false,
      error: check.error ?? "invalid_alias",
    });
  }

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("profiles")
      .select("id")
      .ilike("alias", check.value)
      .limit(1);
    if (error) throw error;
    return NextResponse.json({ available: !data || data.length === 0 });
  } catch {
    return NextResponse.json(
      { available: false, error: "server_error" },
      { status: 500 }
    );
  }
}
