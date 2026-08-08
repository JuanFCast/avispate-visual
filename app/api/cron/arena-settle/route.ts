import { NextResponse } from "next/server";
import {
  confirmSettlement,
  recordRefund,
  settlementOf,
} from "@/lib/supabase/arena-escrow-db";
import {
  pendingSettlements,
  staleOpenTables,
} from "@/lib/supabase/arena-settle-hook";
import { settleTable, voidAndRefund } from "@/lib/arena-settle";
import { escrowConfigured } from "@/lib/arena-escrow";
import { decideStaleTable } from "@/lib/arena-start";
import { ROOM_TTL_MS } from "@/lib/arena-rooms";

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

  /*
   * Y la otra mitad, que no existía: las mesas que nunca llegaron a empezar.
   *
   * Alguien pagó, se quedó esperando rival y no apareció nadie. No hay partida
   * que liquidar y por eso el camino de arriba nunca las veía; el dinero se
   * quedaba en el contrato hasta que el propio jugador supiera reclamarlo. La
   * regla es la de siempre —mesa anulada, devolución íntegra y sin comisión— y
   * ahora la empuja la casa, que es de quien fue el fallo de organización.
   */
  const refunded: string[] = [];
  for (const table of await staleOpenTables()) {
    const verdict = decideStaleTable({
      hasMatch: table.hasMatch,
      roomClosed: table.roomClosed,
      ageMs: Date.now() - new Date(table.createdAt).getTime(),
      alreadyRefunded: table.alreadyRefunded,
      ttlMs: ROOM_TTL_MS,
    });
    if (verdict !== "refund") continue;

    try {
      // El contrato es el que decide de verdad: `voidTable` revierte si la mesa
      // ya se liquidó, así que no hay forma de anular por detrás una partida
      // jugada aunque nuestra foto estuviera equivocada.
      const { refunds } = await voidAndRefund(table.tableId);
      for (const r of refunds) {
        await recordRefund({
          tableId: table.tableId,
          address: r.player,
          amountUnits: table.entryUnits,
          txHash: r.hash,
        });
      }
      if (refunds.length > 0) refunded.push(table.tableId);
    } catch {
      // La barrida de mañana lo vuelve a intentar; el dinero no se mueve solo.
    }
  }

  return NextResponse.json({
    ok: true,
    settled: done.length,
    failed: failed.length,
    refunded: refunded.length,
  });
}
