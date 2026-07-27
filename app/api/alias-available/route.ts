import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { validateAlias } from "@/lib/alias";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-f]{40}$/i;

/**
 * GET /api/alias-available?alias=Pipe[&wallet=0x…] — dice si un alias está
 * libre (sin distinguir mayúsculas). Lectura pública; sirve para avisar ANTES
 * de jugar. La unicidad definitiva la reimpone el servidor al guardar el
 * puntaje.
 *
 * Con `wallet`, un alias que YA ES de esa wallet cuenta como disponible: si no,
 * quien vuelve desde otro teléfono se queda bloqueado por su propio nombre.
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
  const wallet = url.searchParams.get("wallet") ?? "";

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("profiles")
      .select("id, wallet_address")
      .ilike("alias", check.value)
      .limit(1);
    if (error) throw error;

    const owner = data?.[0];
    if (!owner) return NextResponse.json({ available: true });

    const mine =
      ADDR_RE.test(wallet) &&
      owner.wallet_address === wallet.toLowerCase();
    return NextResponse.json({ available: mine, mine });
  } catch {
    return NextResponse.json(
      { available: false, error: "server_error" },
      { status: 500 }
    );
  }
}
