import { NextResponse } from "next/server";
import {
  ensureProfileByWallet,
  setAliasIfEmpty,
} from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyPlayTx } from "@/lib/onchain";
import { validateAlias } from "@/lib/alias";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];
const TX_RE = /^0x[0-9a-f]{64}$/i;
const ADDR_RE = /^0x[0-9a-f]{40}$/i;

/**
 * POST /api/plays — deja constancia de una jugada COBRADA, apenas la
 * transacción `play(deck)` se confirma y antes de que el jugador empiece.
 *
 * El resultado sigue yendo a /api/scores al terminar. La diferencia es que si
 * ese envío final nunca llega (se cae la red, el jugador cierra la app, el
 * servidor falla), aquí ya quedó registrado que esa wallet pagó su entrada o
 * gastó su jugada gratis del día: se puede compensar a quien corresponda en
 * vez de perderle la plata en silencio.
 *
 * Idempotente por `tx_hash`: reintentar el registro no crea filas repetidas.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { txHash, player, deckSize, alias } = body;
  if (typeof txHash !== "string" || !TX_RE.test(txHash))
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  if (typeof player !== "string" || !ADDR_RE.test(player))
    return NextResponse.json({ error: "invalid_player" }, { status: 400 });
  if (!DECK_SIZES.includes(deckSize))
    return NextResponse.json({ error: "invalid_deck_size" }, { status: 400 });

  try {
    // Mismo cheque que en /api/scores: la transacción ES la prueba de que la
    // wallet pagó. Sin esto, cualquiera podría inventarse jugadas.
    const check = await verifyPlayTx(txHash, player, deckSize);
    if (!check.ok || !check.player)
      return NextResponse.json({ error: "invalid_payment" }, { status: 400 });

    const profile = await ensureProfileByWallet(check.player);

    // El alias es "si viene, mejor": el recibo del pago nunca se bloquea por
    // un problema de nombre. Si falta, /api/scores lo exigirá al terminar.
    if (!profile.alias && typeof alias === "string") {
      const valid = validateAlias(alias);
      if (valid.ok && valid.value) await setAliasIfEmpty(profile.id, valid.value);
    }

    const db = getSupabaseAdmin();
    const { error } = await db.from("plays").upsert(
      {
        profile_id: profile.id,
        tx_hash: txHash.toLowerCase(),
        deck_size: deckSize,
        is_paid: !check.wasFree,
      },
      { onConflict: "tx_hash", ignoreDuplicates: true }
    );
    // 23505 = ya estaba registrada; para nosotros es éxito.
    if (error && error.code !== "23505") throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
