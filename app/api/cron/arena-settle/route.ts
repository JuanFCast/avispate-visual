import { NextResponse } from "next/server";
import {
  confirmSettlement,
  settlementOf,
} from "@/lib/supabase/arena-escrow-db";
import { pendingSettlements } from "@/lib/supabase/arena-settle-hook";
import { settleTable } from "@/lib/arena-settle";
import { escrowConfigured } from "@/lib/arena-escrow";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/arena-settle — paga las mesas que quedaron reclamadas y sin
 * entregar.
 *
 * Es la red debajo del camino normal. Cuando una partida termina se intenta
 * pagar en el acto, pero esa transacción puede fallar: el nodo no responde, al
 * operator se le acabó el CELO, el servidor se reinició en medio. Nada de eso
 * puede costarle el premio a nadie — el dinero sigue en el contrato, solo no se
 * ha entregado —, así que alguien tiene que volver a intentarlo.
 *
 * Es idempotente por partida doble: la fila ya está reclamada (una por mesa,
 * por índice único) y el contrato rechaza una mesa que ya pagó. Correrlo dos
 * veces a la vez no paga dos veces.
 */
export async function GET(req: Request) {
  // Mismo candado que el resto de crons: sin el secreto no se toca dinero.
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!secret || given !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!escrowConfigured()) {
    return NextResponse.json({ ok: true, skipped: "escrow_disabled" });
  }

  const pending = await pendingSettlements();
  const done: string[] = [];
  const failed: string[] = [];

  for (const row of pending) {
    try {
      // Puede haberse confirmado entre la consulta y ahora: se relee antes de
      // gastar una transacción.
      const current = await settlementOf(row.table_id);
      if (current?.tx_hash) continue;

      const hash = await settleTable(
        row.table_id,
        row.winner_address,
        row.reason
      );
      if (hash) {
        await confirmSettlement(row.table_id, hash);
        done.push(row.table_id);
      } else {
        // El contrato dice que esa mesa ya no es pagable: o la pagó otro
        // intento, o se anuló. En ninguno de los dos casos hay que insistir.
        failed.push(row.table_id);
      }
    } catch {
      failed.push(row.table_id);
    }
  }

  return NextResponse.json({ ok: true, settled: done.length, failed: failed.length });
}
