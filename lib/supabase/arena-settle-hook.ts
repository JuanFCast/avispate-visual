import { getSupabaseAdmin } from "./server";
import { claimSettlement, confirmSettlement, recordRefund } from "./arena-escrow-db";
import { settleTable, voidAndRefund } from "../arena-settle";
import { arenaPrize } from "../arena";

/**
 * El puente entre "la partida terminó" y "el dinero se movió".
 *
 * Se llama cuando una partida se cierra, por cualquiera de las dos vías: porque
 * alguien vació su mazo o porque los demás se fueron. No decide nada — quién
 * ganó ya está decidido y anotado — solo ejecuta.
 *
 * Dos cosas que valen más que el resto del archivo:
 *
 *   · **Se reclama en la base ANTES de mandar la transacción.** El índice único
 *     sobre `table_id` es lo que impide que dos peticiones simultáneas paguen
 *     el mismo pozo dos veces. Al revés —pagar y luego anotar— una caída en
 *     medio dejaría un pozo pagado sin rastro y el siguiente intento lo pagaría
 *     otra vez.
 *   · **La transacción no bloquea al jugador.** Se dispara sin esperarla: la
 *     pantalla de resultados no tiene por qué mirar a la cadena. Si falla, la
 *     fila queda sin hash y el cron la reintenta.
 */

/** Dirección que PAGÓ esa silla. Es la única a la que el contrato puede pagar. */
async function payerAddressOf(
  roomId: string,
  profileId: string
): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("arena_room_players")
    .select("wallet_address")
    .eq("room_id", roomId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return (data?.wallet_address as string | null) ?? null;
}

export async function settleFinishedMatch(params: {
  roomId: string;
  tableId: string | null;
  entryUnits: bigint;
  maxPlayers: number;
  winnerProfileId: string | null;
  reason: "cleared" | "abandoned" | null;
}): Promise<void> {
  // Mesa gratis: no hay nada que mover.
  if (!params.tableId) return;

  const prize = arenaPrize(params.entryUnits, params.maxPlayers);

  // Sin ganador no hay a quién pagarle: la mesa se anula y cada quien recupera
  // su entrada. Es el único camino que devuelve dinero.
  if (!params.winnerProfileId) {
    try {
      const { refunds } = await voidAndRefund(params.tableId);
      for (const r of refunds) {
        await recordRefund({
          tableId: params.tableId,
          address: r.player,
          amountUnits: params.entryUnits,
          txHash: r.hash,
        });
      }
    } catch {
      // El cron reintenta. Lo que no se puede es dejar la partida colgada por
      // esto, ni mucho menos pagarle a alguien que no ganó.
    }
    return;
  }

  const winner = await payerAddressOf(params.roomId, params.winnerProfileId);
  // Ganó alguien cuya silla no consta pagada. No se paga a ciegas: se deja sin
  // reclamar para que se mire. Con el escrow puesto esto no debería ocurrir —
  // sin pagar no hay silla— y justo por eso conviene enterarse si ocurre.
  if (!winner) return;

  const claimed = await claimSettlement({
    roomId: params.roomId,
    tableId: params.tableId,
    winnerProfileId: params.winnerProfileId,
    winnerAddress: winner,
    reason: params.reason ?? "cleared",
    prizeUnits: prize.winnerUnits,
    commissionUnits: prize.commissionUnits,
  });
  // Ya la reclamó otro: que la termine él.
  if (claimed.status !== "ok") return;

  try {
    const hash = await settleTable(
      params.tableId,
      winner,
      params.reason ?? "cleared"
    );
    if (hash) await confirmSettlement(params.tableId, hash);
  } catch {
    // Queda sin hash y el cron la retoma. El dinero sigue en el contrato: no
    // se ha perdido, solo no se ha entregado todavía.
  }
}

/**
 * Mesas pagadas que NUNCA llegaron a empezar y ya no van a hacerlo.
 *
 * Es el caso que no tenía dueño: alguien paga su entrada, se queda esperando
 * rival y no aparece nadie. No hubo partida, así que no hay liquidación que
 * disparar; la sala vence a las dos horas y hasta hoy ahí se acababa la
 * historia para nosotros, con la entrada dentro del contrato. El jugador podía
 * recuperarla —`voidByTimeout` y `refund` los llama cualquiera, a propósito—
 * pero eso significa saber hablarle a un contrato, que es lo mismo que no
 * poder.
 *
 * Devuelve las candidatas; quién decide es `decideStaleTable`, y quien mueve el
 * dinero es el cron.
 */
export async function staleOpenTables(limit = 20): Promise<
  {
    roomId: string;
    tableId: string;
    entryUnits: bigint;
    createdAt: string;
    roomClosed: boolean;
    hasMatch: boolean;
    alreadyRefunded: boolean;
  }[]
> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_rooms")
    .select("id, table_id, entry_units, status, created_at")
    .not("table_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const rooms = (data ?? []) as {
    id: string;
    table_id: string;
    entry_units: string;
    status: string;
    created_at: string;
  }[];

  const out = [];
  for (const room of rooms) {
    // Dos preguntas por sala, y las dos son índices: si llegó a repartirse y si
    // ya se devolvió algo de esa mesa. Con el tope de 20 por barrida, sale
    // barato y no hace falta una vista.
    const { count: matches } = await db
      .from("arena_matches")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id);
    const { count: refunds } = await db
      .from("arena_refunds")
      .select("id", { count: "exact", head: true })
      .eq("table_id", room.table_id.toLowerCase());

    out.push({
      roomId: room.id,
      tableId: room.table_id,
      entryUnits: BigInt(room.entry_units),
      createdAt: room.created_at,
      roomClosed: room.status !== "open",
      hasMatch: (matches ?? 0) > 0,
      alreadyRefunded: (refunds ?? 0) > 0,
    });
  }
  return out;
}

/**
 * Liquidaciones reclamadas que nunca llegaron a la cadena. Las retoma el cron.
 *
 * Que exista este camino es lo que permite que el de arriba no espere: una
 * transacción que falla no puede dejar a nadie sin su premio, solo retrasarlo.
 */
export async function pendingSettlements(limit = 20): Promise<
  { table_id: string; winner_address: string; reason: "cleared" | "abandoned" }[]
> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_settlements")
    .select("table_id, winner_address, reason")
    .is("tx_hash", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as {
    table_id: string;
    winner_address: string;
    reason: "cleared" | "abandoned";
  }[];
}
