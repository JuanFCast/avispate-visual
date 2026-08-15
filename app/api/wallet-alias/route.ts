import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-f]{40}$/i;

/**
 * GET /api/wallet-alias?address=0x… — el alias que ya tiene esa wallet.
 *
 * El alias pertenece a la BILLETERA, no al teléfono. Antes solo vivía en el
 * `localStorage` del dispositivo, así que cambiar de navegador, de celular o
 * de dominio hacía "desaparecer" el alias y la app volvía a pedirlo (y encima
 * lo rechazaba por estar tomado... por uno mismo). Con esto, la wallet llega a
 * cualquier dispositivo y recupera su nombre sola.
 *
 * Público a propósito: la pareja alias ↔ wallet ya es visible en el ranking.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!ADDR_RE.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  /**
   * DIAGNÓSTICO TEMPORAL — se quita al cerrar el caso de MiniPay.
   *
   * Esta ruta se está pidiendo 8 veces en 22 segundos dentro de MiniPay, y con
   * `staleTime` de 5 minutos eso solo puede significar que la CLAVE cambia, o
   * sea que la dirección conectada oscila. Los logs de Vercel no traen la
   * query, así que aquí queda anotada — abreviada, igual que en toda la app, y
   * la pareja alias ↔ wallet ya es pública en el ranking.
   */
  console.log("wallet_alias_lookup", {
    address: `${address.slice(0, 8)}…${address.slice(-4)}`.toLowerCase(),
  });

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("profiles")
      .select("alias")
      .eq("wallet_address", address.toLowerCase())
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({ alias: data?.alias ?? null });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
