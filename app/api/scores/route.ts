import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import {
  ensureProfile,
  ensureProfileByWallet,
  setAliasIfEmpty,
} from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyPlayTx } from "@/lib/onchain";
import { validateAlias } from "@/lib/alias";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_RE = /^0x[0-9a-f]{64}$/i;
const ADDR_RE = /^0x[0-9a-f]{40}$/i;

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

interface ScoreCore {
  clientGameId: string;
  deckSize: number;
  totalMs: number;
  averageMs: number;
  errors: number;
  accuracy: number;
}

/** Valida los campos comunes de una partida. Devuelve error string o null. */
function validateCore(body: Record<string, unknown>): ScoreCore | string {
  const { clientGameId, deckSize, totalMs, averageMs, errors, accuracy } = body;
  if (typeof clientGameId !== "string" || !UUID_RE.test(clientGameId))
    return "invalid_client_game_id";
  if (!DECK_SIZES.includes(deckSize as number)) return "invalid_deck_size";
  if (!isInt(totalMs) || totalMs < 0 || !isInt(averageMs) || averageMs < 0)
    return "invalid_time";
  if (!isInt(errors) || errors < 0) return "invalid_errors";
  if (!isInt(accuracy) || accuracy < 0 || accuracy > 100) return "invalid_accuracy";
  return {
    clientGameId,
    deckSize: deckSize as number,
    totalMs,
    averageMs,
    errors,
    accuracy,
  };
}

/**
 * POST: registra una partida terminada.
 *   - mode "free" (por defecto): jugada gratis, autenticada por Privy (correo).
 *     Una por mazo y ronda (día).
 *   - mode "paid": jugada paga, identidad = wallet probada por el pago on-chain
 *     (txHash verificado). Idempotente por tx_hash / clientGameId.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const core = validateCore(body);
  if (typeof core === "string")
    return NextResponse.json({ error: core }, { status: 400 });

  return body.mode === "paid"
    ? handlePaid(req, body, core)
    : handleFree(req, core);
}

/** Jugada GRATIS: Privy + una por mazo/ronda. */
async function handleFree(req: Request, core: ScoreCore) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  try {
    const profile = await ensureProfile(auth.identity);
    if (!profile.alias) {
      return NextResponse.json({ error: "alias_required" }, { status: 409 });
    }

    const db = getSupabaseAdmin();
    // onConflict clientGameId + ignoreDuplicates: reintento del MISMO juego no
    // duplica. Un SEGUNDO juego gratis (mazo/ronda) viola scores_one_free_per_round
    // → 23505 → "free_used".
    const { error } = await db.from("scores").upsert(
      {
        profile_id: profile.id,
        client_game_id: core.clientGameId,
        deck_size: core.deckSize,
        total_ms: core.totalMs,
        average_ms: core.averageMs,
        errors: core.errors,
        accuracy: core.accuracy,
        is_paid: false,
      },
      { onConflict: "client_game_id", ignoreDuplicates: true }
    );
    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: "free_used" }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/** Jugada PAGA: wallet + txHash verificado on-chain. */
async function handlePaid(
  req: Request,
  body: Record<string, unknown>,
  core: ScoreCore
) {
  const { txHash, player, alias } = body;
  if (typeof txHash !== "string" || !TX_RE.test(txHash))
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  if (typeof player !== "string" || !ADDR_RE.test(player))
    return NextResponse.json({ error: "invalid_player" }, { status: 400 });

  try {
    // El pago on-chain ES la prueba de identidad de la wallet.
    const check = await verifyPlayTx(txHash, player, core.deckSize);
    if (!check.ok || !check.player)
      return NextResponse.json({ error: "invalid_payment" }, { status: 400 });

    const profile = await ensureProfileByWallet(check.player);

    // Alias: si la wallet aún no tiene, hay que enviarlo en esta jugada.
    if (!profile.alias) {
      if (typeof alias !== "string")
        return NextResponse.json({ error: "alias_required" }, { status: 409 });
      const valid = validateAlias(alias);
      if (!valid.ok || !valid.value)
        return NextResponse.json(
          { error: valid.error ?? "invalid_alias" },
          { status: 400 }
        );
      const res = await setAliasIfEmpty(profile.id, valid.value);
      if (res.status === "taken")
        return NextResponse.json({ error: "alias_taken" }, { status: 409 });
    }

    const db = getSupabaseAdmin();
    // Idempotencia: mismo clientGameId se ignora; tx_hash repetido dispara
    // scores_tx_hash_key (23505) → la jugada ya se registró (ok idempotente).
    const { error } = await db.from("scores").upsert(
      {
        profile_id: profile.id,
        client_game_id: core.clientGameId,
        deck_size: core.deckSize,
        total_ms: core.totalMs,
        average_ms: core.averageMs,
        errors: core.errors,
        accuracy: core.accuracy,
        is_paid: true,
        tx_hash: txHash.toLowerCase(),
      },
      { onConflict: "client_game_id", ignoreDuplicates: true }
    );
    if (error && error.code !== "23505") throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
