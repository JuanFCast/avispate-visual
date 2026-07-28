import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  previousRoundId,
  roundClosesAt,
  roundIdAt,
  roundOpensAt,
} from "@/lib/round-time";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];

/**
 * Cuánto se queda la interfaz mostrando el resultado de la ronda que acaba de
 * cerrar antes de pasar a la cuenta regresiva de la siguiente. Corto a
 * propósito: la ronda nueva ya acepta jugadas, así que enseñar al ganador no
 * puede parecer que el juego está cerrado.
 */
const SHOWCASE_MS =
  Math.max(0, Number(process.env.ROUND_RESULT_SHOWCASE_SECONDS ?? 90)) * 1000;

/**
 * Cuánto rato después del cierre seguimos preguntando por el ganador de la
 * ronda que acaba de terminar. Pasado esto, el resultado ya solo vive en
 * /historial: no vale la pena tocar la base en cada visita del resto del día.
 */
const RESULT_LOOKUP_MS = 15 * 60_000;

interface SettlementRow {
  winner_wallet: string | null;
  amount_units: number | string | null;
  tx_hash: string | null;
  created_at: string;
  profiles: { alias: string | null } | null;
}

/** Nunca se expone la dirección completa de un ganador. */
function shorten(address: string | null): string | null {
  if (!address) return null;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * GET /api/round?deck=10 — contrato de tiempo de la ronda. Es la fuente de
 * verdad del contador: el cliente no decide cuándo cambia la ronda, solo
 * dibuja lo que aquí se le dice.
 *
 *   roundId   ronda que la interfaz debe mostrar
 *   serverNow reloj del servidor, para corregir teléfonos desajustados
 *   closesAt  instante universal del cierre de `roundId` (pasado si ya cerró)
 *   status    open · settled
 *   winner    solo en `settled`: quién ganó ese mazo y cómo quedó el pago
 *
 * Por defecto se responde la ronda ABIERTA. La única excepción es el momento
 * de celebración: los primeros `SHOWCASE_MS` después de que se liquida una
 * ronda se muestra a su ganador. Una liquidación que se demora no cambia nada
 * de lo que ve el jugador.
 *
 * Lectura pública, sin sesión. Sin caché: `serverNow` debe ser real.
 */
export async function GET(req: Request) {
  const deck = Number(new URL(req.url).searchParams.get("deck") ?? 10);
  if (!DECK_SIZES.includes(deck)) {
    return NextResponse.json({ error: "invalid_deck_size" }, { status: 400 });
  }

  const now = Date.now();
  const openRound = roundIdAt(now);
  // La ronda anterior cerró exactamente cuando se abrió la actual.
  const closedRound = previousRoundId(openRound);
  const closedAt = roundOpensAt(openRound);

  const openPayload = {
    roundId: openRound,
    deck,
    serverNow: new Date(now).toISOString(),
    closesAt: new Date(roundClosesAt(now)).toISOString(),
    status: "open" as const,
    winner: null,
  };

  const noStore = { headers: { "Cache-Control": "no-store" } };

  // Fuera de la ventana de liquidación no hay nada que consultar: el 99% de
  // las visitas se resuelve sin tocar la base.
  if (now - closedAt >= RESULT_LOOKUP_MS) {
    return NextResponse.json(openPayload, noStore);
  }

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("round_settlements")
      .select("winner_wallet, amount_units, tx_hash, created_at, profiles(alias)")
      .eq("round_date", closedRound)
      .eq("deck_size", deck)
      .maybeSingle();
    if (error) throw error;

    const row = data as unknown as SettlementRow | null;
    const closedPayload = {
      roundId: closedRound,
      deck,
      serverNow: new Date(now).toISOString(),
      closesAt: new Date(closedAt).toISOString(),
    };

    // Cerró y el robot todavía no escribe la fila. Aquí NO se anuncia "ronda
    // cerrada": a esta hora la ronda nueva lleva rato abierta y aceptando
    // jugadas, y decirle al jugador que se está calculando un ganador lo deja
    // mirando un cartel de cerrado con el juego funcionando. Que el robot se
    // demore es problema nuestro, no suyo — el ganador saldrá en /historial.
    if (!row) {
      return NextResponse.json(openPayload, noStore);
    }

    // Ya liquidada: se enseña un momento y luego manda la ronda nueva.
    const settledAt = Date.parse(row.created_at);
    if (!Number.isNaN(settledAt) && now - settledAt < SHOWCASE_MS) {
      return NextResponse.json(
        {
          ...closedPayload,
          status: "settled" as const,
          winner: {
            alias: row.profiles?.alias ?? null,
            wallet: shorten(row.winner_wallet),
            amountUnits:
              row.amount_units === null ? null : String(row.amount_units),
            txHash: row.tx_hash,
            payout: row.tx_hash
              ? ("paid" as const)
              : row.winner_wallet
                ? ("pending" as const)
                : ("rollover" as const),
          },
        },
        noStore
      );
    }

    return NextResponse.json(openPayload, noStore);
  } catch {
    // Fail-open: si la base falla, el contador sigue funcionando.
    return NextResponse.json(openPayload, noStore);
  }
}
