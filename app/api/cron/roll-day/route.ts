import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readPot, settleDecks } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DECKS = [10, 15, 20];
const DAY_MS = 86_400_000;

/**
 * Colchón tras el cierre (00:00 UTC = 7:00 p. m. Colombia) antes de leer el
 * ranking. Una partida que termina a las 6:59:59 p. m. todavía tiene que
 * verificarse on-chain antes de guardarse; sin esta pausa el robot podría leer
 * el ranking un instante antes de que esa última jugada aterrice y dejar por
 * fuera al ganador. Bajarlo paga más rápido; subirlo es más justo.
 */
const GRACE_MS = Math.max(0, Number(process.env.SETTLE_GRACE_SECONDS ?? 8)) * 1000;
/** Nunca esperar más que esto (protege el presupuesto de 60 s de la función). */
const MAX_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Se para justo del lado correcto del cierre. Los disparadores apuntan a las
 * 00:00 UTC en punto, así que al entrar aquí faltan segundos para el cierre o
 * acaba de pasar: en ambos casos se espera hasta cierre + GRACE_MS.
 */
async function waitForRoundClose(): Promise<number> {
  const intoDay = Date.now() % DAY_MS; // el epoch está alineado a medianoche UTC
  // Justo ANTES de medianoche (disparo adelantado o reloj corrido).
  if (intoDay > DAY_MS - 60_000) {
    const wait = Math.min(DAY_MS - intoDay + GRACE_MS, MAX_WAIT_MS);
    await sleep(wait);
    return wait;
  }
  // Justo DESPUÉS de medianoche: completar el colchón.
  if (intoDay < GRACE_MS) {
    const wait = Math.min(GRACE_MS - intoDay, MAX_WAIT_MS);
    await sleep(wait);
    return wait;
  }
  return 0;
}

/** Fecha de la ronda a liquidar por defecto: la que acaba de cerrar (UTC). */
function defaultRound(): string {
  return new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
}

interface WinnerRow {
  profile_id: string;
  profiles: { wallet_address: string | null } | null;
}

interface DeckPlan {
  deck: number;
  pot: bigint;
  winner: string | null;
  winnerProfileId: string | null;
  queryFailed: boolean;
}

/** #1 de la ronda para un mazo: menor promedio; a igualdad, menos errores. */
async function topOfRound(
  db: SupabaseClient,
  deck: number,
  round: string
): Promise<{ row?: WinnerRow; failed: boolean }> {
  const { data, error } = await db
    .from("scores")
    .select("profile_id, profiles!inner(wallet_address)")
    .eq("deck_size", deck)
    .eq("round_date", round)
    .order("average_ms", { ascending: true })
    .order("errors", { ascending: true })
    .limit(1);
  if (error) return { failed: true };
  return { row: (data ?? [])[0] as unknown as WinnerRow | undefined, failed: false };
}

/**
 * GET /api/cron/roll-day — liquida la ronda: por cada mazo, paga el pozo al #1
 * y lo reinicia. Protegido por CRON_SECRET (los disparadores lo mandan como
 * Bearer). Idempotente por (round_date, deck) vía round_settlements.
 *
 * Está escrito para pagar en segundos, no en minutos: los tres mazos se
 * consultan y se liquidan EN PARALELO, y la fila de round_settlements se
 * escribe apenas confirma el pago, para cerrar cuanto antes la ventana en la
 * que un segundo disparador podría pagar dos veces.
 *
 * Esta ruta SOLO paga. Volver a llenar los pozos es cosa de
 * `/api/cron/seed-pots`, que corre cada hora por su cuenta — ver el paso 5.
 */
export async function GET(req: Request) {
  // Fail-closed: sin CRON_SECRET configurado, o con Bearer incorrecto, se bloquea
  // SIEMPRE. Así nadie puede disparar liquidaciones desde afuera.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Sondeo de salud: confirma que la URL responde y que el secreto coincide,
  // sin liquidar, sin pagar y sin escribir una sola fila. Existe porque la
  // alternativa —probar con ?date= de una fecha cualquiera— NO es inocua: una
  // ronda sin partidas no tiene ganador, pero el endpoint igual registra la
  // transición, así que cada prueba dejaba tres filas basura en
  // round_settlements. El robot de Supabase usa esto para verificarse.
  const params = new URL(req.url).searchParams;
  if (params.get("probe") === "1") {
    return NextResponse.json({ ok: true, probe: true, now: new Date().toISOString() });
  }

  const started = Date.now();
  const explicitDate = params.get("date");
  // Con ?date= explícito (rescate manual) no hay nada que esperar.
  const waitedMs = explicitDate ? 0 : await waitForRoundClose();
  const round = explicitDate ?? defaultRound();

  const db = getSupabaseAdmin();

  // 1. Descartar lo ya liquidado (idempotencia entre disparadores).
  const { data: done, error: doneError } = await db
    .from("round_settlements")
    .select("deck_size")
    .eq("round_date", round);
  if (doneError) {
    return NextResponse.json({ error: "settlements_query_failed" }, { status: 500 });
  }
  const settled = new Set((done ?? []).map((r) => r.deck_size as number));
  const decks = DECKS.filter((d) => !settled.has(d));
  if (decks.length === 0) {
    return NextResponse.json({ round, waitedMs, results: [], note: "already_settled" });
  }

  // 2. Pozo y ganador de cada mazo, todo a la vez.
  const plans: DeckPlan[] = await Promise.all(
    decks.map(async (deck): Promise<DeckPlan> => {
      const [pot, top] = await Promise.all([readPot(deck), topOfRound(db, deck, round)]);
      return {
        deck,
        pot,
        winner: top.row?.profiles?.wallet_address ?? null,
        winnerProfileId: top.row?.profile_id ?? null,
        queryFailed: top.failed,
      };
    })
  );

  // 3. Pagar los que tienen pozo y un ganador con wallet, en una sola tanda.
  //    (pot > 0 sin ganador con wallet: el pozo rueda al día siguiente.)
  const payable = plans.filter((p) => !p.queryFailed && p.pot > 0n && p.winner);
  const settles = await settleDecks(
    payable.map((p) => ({ deck: p.deck, winner: p.winner as string }))
  );
  const txByDeck = new Map(
    settles.filter((s) => s.ok).map((s) => [s.deck, s.txHash as string])
  );
  const errByDeck = new Map(
    settles.filter((s) => !s.ok).map((s) => [s.deck, s.error ?? "settle_failed"])
  );

  // 4. Registrar la transición. Se saltan los mazos cuya consulta falló o cuyo
  //    pago falló: sin fila, el próximo disparador los reintenta.
  const recorded = plans.filter(
    (p) => !p.queryFailed && !errByDeck.has(p.deck)
  );
  if (recorded.length > 0) {
    await db.from("round_settlements").insert(
      recorded.map((p) => ({
        round_date: round,
        deck_size: p.deck,
        winner_profile_id: txByDeck.has(p.deck) ? p.winnerProfileId : null,
        winner_wallet: txByDeck.has(p.deck) ? p.winner : null,
        tx_hash: txByDeck.get(p.deck) ?? null,
        amount_units: txByDeck.has(p.deck) ? p.pot.toString() : null,
      }))
    );
  }

  // 5. Aquí NO se siembra. Antes esto llamaba `seedPots([...txByDeck.keys()])`
  //    —"resiembro los mazos que acabo de pagar"— y esa única línea es la que
  //    dejó los tres pozos en 0,00 la madrugada del 2026-08-16: la siembra no
  //    salió, el respaldo de las 00:05 devolvía `already_settled` sin llegar
  //    hasta aquí, y desde el día siguiente un pozo en cero ya ni entraba a
  //    liquidarse (el filtro `pot > 0n` de arriba), así que nunca volvía a
  //    haber un pago que disparara la resiembra. Cero era un estado del que no
  //    se salía.
  //
  //    Sembrar es ahora un trabajo aparte, idempotente y con su propio reloj:
  //    `/api/cron/seed-pots`, cada hora en el minuto :35. Que este cierre falle
  //    ya no puede dejar el pozo muerto, y que la siembra falle tampoco.
  const results = plans.map((p) => ({
    deck: p.deck,
    winner: txByDeck.has(p.deck) ? p.winner : null,
    settleTx: txByDeck.get(p.deck) ?? null,
    error: p.queryFailed ? "query_failed" : errByDeck.get(p.deck),
  }));

  return NextResponse.json({
    round,
    waitedMs,
    elapsedMs: Date.now() - started,
    results,
  });
}
