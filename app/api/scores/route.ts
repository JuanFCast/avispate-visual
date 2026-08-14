import { NextResponse } from "next/server";
import {
  ensureProfileByWallet,
  setAliasIfEmpty,
} from "@/lib/supabase/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyPlayTx } from "@/lib/onchain";
import { validateAlias } from "@/lib/alias";
import { verifyScoreMoves } from "@/lib/score-verify";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_RE = /^0x[0-9a-f]{64}$/i;
const ADDR_RE = /^0x[0-9a-f]{40}$/i;

interface ScoreCore {
  clientGameId: string;
  deckSize: number;
  moves: unknown;
}

/**
 * Valida los campos comunes de una partida. Devuelve error string o null.
 *
 * Ya NO valida `totalMs`/`averageMs`/`errors`/`accuracy`: esos los calcula el
 * servidor rejugando `moves` contra la semilla real (`verifyScoreMoves`), más
 * abajo. Antes se aceptaban tal cual llegaran del cliente — ver la auditoría
 * del 2026-08-13, era el hueco más grave del proyecto.
 */
function validateCore(body: Record<string, unknown>): ScoreCore | string {
  const { clientGameId, deckSize, moves } = body;
  if (typeof clientGameId !== "string" || !UUID_RE.test(clientGameId))
    return "invalid_client_game_id";
  if (!DECK_SIZES.includes(deckSize as number)) return "invalid_deck_size";
  if (!Array.isArray(moves) || moves.length === 0) return "invalid_moves";
  return { clientGameId, deckSize: deckSize as number, moves };
}

/**
 * POST: registra una partida terminada. Desde el contrato v2 TODA jugada
 * (gratis o paga) es una transacción `play(deck)` on-chain: el txHash es la
 * prueba de identidad de la wallet y el evento `Played` dice si fue gratis
 * (`wasFree`) o paga. El límite de una gratis por mazo/día lo hace cumplir el
 * propio contrato; aquí solo se refleja en `is_paid`. Idempotente por
 * tx_hash / clientGameId.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const core = validateCore(body);
  if (typeof core === "string")
    return NextResponse.json({ error: core }, { status: 400 });

  const { txHash, player, alias } = body;
  if (typeof txHash !== "string" || !TX_RE.test(txHash))
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  if (typeof player !== "string" || !ADDR_RE.test(player))
    return NextResponse.json({ error: "invalid_player" }, { status: 400 });

  try {
    // La transacción on-chain ES la prueba de identidad de la wallet.
    const check = await verifyPlayTx(txHash, player, core.deckSize);
    if (!check.ok || !check.player)
      return NextResponse.json({ error: "invalid_payment" }, { status: 400 });

    /**
     * Pagó una dirección distinta a la que dice el cliente. La partida NO se
     * registra: atribuirla al pagador real por nuestra cuenta sería ponerle
     * dueño a una marca que nadie ha reclamado. El recibo del pago ya quedó
     * guardado a nombre de quien pagó en `/api/plays`, así que el dinero no se
     * pierde; lo que falta es que la persona reconcilie su identidad.
     */
    if (check.payerMismatch)
      return NextResponse.json(
        { error: "payer_mismatch", payer: check.player },
        { status: 409 }
      );

    const db = getSupabaseAdmin();

    /**
     * La semilla real la generó `/api/plays` antes de que el jugador viera la
     * primera carta — este txHash es la misma llave que usa esa tabla, así que
     * si no hay fila ahí, no hay semilla con la que rejugar, y el envío se
     * rechaza. `deck_size` se cruza también: aunque `verifyPlayTx` ya exige que
     * coincida con el evento on-chain, comprobarlo otra vez contra el recibo no
     * cuesta nada y cierra una vía más.
     */
    const { data: playRow } = await db
      .from("plays")
      .select("seed, deck_size")
      .eq("tx_hash", txHash.toLowerCase())
      .maybeSingle();
    if (!playRow?.seed || playRow.deck_size !== core.deckSize)
      return NextResponse.json({ error: "invalid_score" }, { status: 400 });

    /**
     * El servidor rejuega el mazo entero contra esa semilla y decide el
     * tiempo/errores/precisión POR SU CUENTA a partir de los toques reales — el
     * cliente ya no manda esos números, y si los mandara no se leerían. Ver
     * `lib/score-verify.ts`.
     */
    const verified = verifyScoreMoves(playRow.seed, core.deckSize, core.moves);
    if (!verified.ok) {
      // El motivo detallado ("too_fast", "non_monotonic"...) se queda en el
      // log del servidor, no en la respuesta: devolverlo tal cual le daría a
      // quien intenta fabricar un puntaje un oráculo para afinar el intento
      // siguiente.
      console.error("score_rejected", { txHash, reason: verified.reason });
      return NextResponse.json({ error: "invalid_score" }, { status: 400 });
    }
    const { totalMs, averageMs, errors, accuracy } = verified.score;

    // Los perfiles de correo también se encuentran aquí: su wallet embebida
    // quedó guardada en el perfil al iniciar sesión.
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

    // Idempotencia: mismo clientGameId se ignora; tx_hash repetido dispara
    // scores_tx_hash_key (23505) → la jugada ya se registró (ok idempotente).
    const { error } = await db.from("scores").upsert(
      {
        profile_id: profile.id,
        client_game_id: core.clientGameId,
        deck_size: core.deckSize,
        total_ms: totalMs,
        average_ms: averageMs,
        errors,
        accuracy,
        is_paid: !check.wasFree,
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
