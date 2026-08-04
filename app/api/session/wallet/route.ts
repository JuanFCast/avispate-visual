import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyWalletControl } from "@/lib/onchain";
import { ensureProfileByWallet } from "@/lib/supabase/profiles";
import { signWalletSession, walletSessionEnabled } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-f]{40}$/i;
const TX_RE = /^0x[0-9a-f]{64}$/i;

/**
 * POST /api/session/wallet — canjea el hash de una jugada reciente por una
 * sesión. Es la puerta de entrada dentro de MiniPay, donde no se puede firmar
 * un mensaje: la transacción `play()` ya la firmó esa wallet, así que sirve de
 * prueba de control (el porqué completo, y su modelo de amenaza, en
 * `lib/wallet-session.ts`).
 *
 * El hash se consume: dos canjes del mismo hash no dan dos sesiones.
 */
export async function POST(req: Request) {
  if (!walletSessionEnabled()) {
    return NextResponse.json({ error: "wallet_login_disabled" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    txHash?: string;
  };
  const address = body.address?.toLowerCase();
  const txHash = body.txHash?.toLowerCase();
  if (!address || !ADDR_RE.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  if (!txHash || !TX_RE.test(txHash)) {
    return NextResponse.json({ error: "invalid_tx" }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // Reclamar el hash ANTES de verificarlo. Al revés (verificar y luego insertar)
  // deja una ventana en la que dos peticiones simultáneas con el mismo hash
  // pasan las dos: la PK es lo que serializa la carrera, así que se toca
  // primero. Si ya estaba, alguien lo canjeó antes.
  const { error: claimError } = await db
    .from("wallet_sessions")
    .insert({ tx_hash: txHash, wallet_address: address });
  if (claimError) {
    // 23505 = ya reclamado. Cualquier otro error es de infraestructura.
    if (claimError.code === "23505") {
      return NextResponse.json({ error: "tx_already_used" }, { status: 409 });
    }
    return NextResponse.json({ error: "session_failed" }, { status: 500 });
  }

  const ok = await verifyWalletControl(txHash, address);
  if (!ok) {
    // No sirvió: se libera el hash para que su dueño legítimo pueda canjearlo
    // (p. ej. si llegó antes de que la transacción se confirmara).
    await db.from("wallet_sessions").delete().eq("tx_hash", txHash);
    return NextResponse.json({ error: "tx_not_valid" }, { status: 403 });
  }

  // Perfil listo antes de devolver el token: así la primera pantalla después de
  // entrar ya encuentra alias y puntajes en vez de un hueco.
  try {
    await ensureProfileByWallet(address);
  } catch {
    return NextResponse.json({ error: "profile_failed" }, { status: 500 });
  }

  return NextResponse.json({ token: signWalletSession(address), address });
}
