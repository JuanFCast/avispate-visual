import { NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { celo } from "viem/chains";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { CELO_TRANSPORT } from "@/lib/chain";
import { AVISPATE_POT_ABI, AVISPATE_POT_ADDRESS } from "@/lib/contracts";
import { DECK_OPTIONS } from "@/lib/game";
import { roundIdAt } from "@/lib/round-time";
import {
  buildDecks,
  buildEconomy,
  buildPlayers,
  buildPlays,
  buildRetention,
  buildToday,
  type ChainSnapshot,
  type StatsPayload,
  type StatsProfileRow,
  type StatsScoreRow,
  type StatsSettlementRow,
} from "@/lib/stats";

/**
 * Tope de filas que se traen por tabla. PostgREST corta en 1000 por petición,
 * así que se pagina; este techo evita que un día con muchísimas partidas
 * convierta el panel en una descarga enorme. Si se alcanza, la respuesta viene
 * marcada como `truncated` y la interfaz lo dice.
 *
 * Cuando `scores` pase de aquí, toca mover la agregación a vistas SQL en
 * Supabase; hasta entonces esto es exacto y no obliga a correr migraciones a
 * mano.
 */
const MAX_ROWS = 50_000;
const PAGE = 1000;

/** Lee una tabla completa paginando, hasta `MAX_ROWS`. */
async function fetchAll<T>(
  table: string,
  columns: string,
  order: string
): Promise<{ rows: T[]; truncated: boolean }> {
  const db = getSupabaseAdmin();
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Lecturas on-chain del panel. Fail-soft a propósito: si el RPC de Celo tose,
 * el panel sale igual con las cifras de la base y los montos de cadena en
 * blanco, en vez de devolver un 500.
 */
async function readChain(): Promise<ChainSnapshot> {
  const empty: ChainSnapshot = {
    potsByDeck: Object.fromEntries(DECK_OPTIONS.map((d) => [d, null])),
    feeUnits: null,
    commissionBps: null,
  };
  if (!AVISPATE_POT_ADDRESS) return empty;

  const client = createPublicClient({ chain: celo, transport: CELO_TRANSPORT });
  const base = {
    address: AVISPATE_POT_ADDRESS as `0x${string}`,
    abi: AVISPATE_POT_ABI,
  } as const;
  /** Una lectura caída no tumba las demás: devuelve null y sigue. */
  const soft = <T>(p: Promise<T>) => p.catch(() => null);

  const [pots, fee, bps] = await Promise.all([
    Promise.all(
      DECK_OPTIONS.map((deck) =>
        soft(
          client.readContract({
            ...base,
            functionName: "pot",
            args: [deck] as const,
          })
        )
      )
    ),
    soft(client.readContract({ ...base, functionName: "feeAmount" })),
    soft(client.readContract({ ...base, functionName: "commissionBps" })),
  ]);

  return {
    potsByDeck: Object.fromEntries(
      DECK_OPTIONS.map((deck, i) => [
        deck,
        pots[i] === null ? null : String(pots[i]),
      ])
    ),
    feeUnits: fee === null ? null : String(fee),
    commissionBps: bps === null ? null : Number(bps),
  };
}

/**
 * GET /api/stats — panel PÚBLICO de estadísticas en vivo.
 *
 * Sin sesión y sin datos personales: solo agregados. Nunca sale de aquí una
 * wallet completa, un correo ni un alias asociado a una dirección; lo que se
 * publica es cuántos, cuánto y qué tan rápido.
 *
 * Se cachea un minuto en el borde: el panel se siente vivo sin que cada visita
 * recorra la base y la cadena.
 */
export async function GET() {
  try {
    const today = roundIdAt(Date.now());

    const [scoresRes, profilesRes, settlementsRes, gasRes, chain] =
      await Promise.all([
        fetchAll<StatsScoreRow>(
          "scores",
          "profile_id, round_date, deck_size, is_paid, average_ms, accuracy, errors, tx_hash",
          "round_date"
        ),
        fetchAll<StatsProfileRow>(
          "profiles",
          "id, created_at, privy_id, wallet_address",
          "created_at"
        ),
        fetchAll<StatsSettlementRow>(
          "round_settlements",
          "round_date, deck_size, amount_units, tx_hash, winner_wallet",
          "round_date"
        ),
        fetchAll<{ amount_wei: string; tx_hash: string | null }>(
          "welcome_airdrops",
          "amount_wei, tx_hash",
          "created_at"
        ),
        readChain(),
      ]);

    const scores = scoresRes.rows;
    const profiles = profilesRes.rows;
    const settlements = settlementsRes.rows;

    const payload: StatsPayload = {
      generatedAt: new Date().toISOString(),
      today: buildToday(scores, profiles, today),
      players: buildPlayers(scores, profiles, today),
      retention: buildRetention(scores, today),
      plays: buildPlays(scores, today),
      decks: buildDecks(scores, settlements, chain, DECK_OPTIONS),
      economy: buildEconomy(scores, settlements, chain),
      chain: {
        potAddress: AVISPATE_POT_ADDRESS || null,
        playTxs: scores.filter((s) => s.tx_hash).length,
        prizeTxs: settlements.filter((s) => s.tx_hash).length,
        wallets: profiles.filter((p) => p.wallet_address).length,
        welcomeGasCount: gasRes.rows.filter((g) => g.tx_hash).length,
        welcomeGasWei: gasRes.rows
          .reduce((acc, g) => acc + BigInt(g.amount_wei || 0), 0n)
          .toString(),
      },
      truncated: scoresRes.truncated || profilesRes.truncated,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
