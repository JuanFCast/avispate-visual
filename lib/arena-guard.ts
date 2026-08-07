import { NextResponse } from "next/server";
import type { AppIdentity } from "./identity";
import { escrowEnabled, paidPlayersOf, tableIdFor } from "./arena-escrow";
import { decideSeatAccess, type SeatAction } from "./arena-seat";
import { getRoomByCode } from "./supabase/arena-rooms";

/**
 * El guardia de las sillas, para las rutas de `/api/arena/*`.
 *
 * `requireIdentity` responde "quién eres"; esto responde algo distinto y más
 * estrecho: **si esa identidad puede tocar ESTA silla**. En una mesa gratis son
 * lo mismo. En una mesa con entrada no, y esa diferencia es la regla del
 * 2026-08-04 — ver el porqué completo en `arena-seat.ts`.
 *
 * Se pone en las rutas que sientan, preparan, empiezan, mueven o levantan. No
 * en las de solo lectura: mirar una sala con el código en la mano no le cuesta
 * dinero a nadie.
 */

const STATUS: Record<string, number> = {
  session_not_allowed_on_paid_table: 403,
  wallet_required: 403,
  seat_not_paid: 403,
};

export interface RoomTerms {
  code: string;
  entryUnits: bigint;
  maxPlayers: number;
}

/**
 * Deja pasar, o devuelve la respuesta lista para retornar.
 *
 * Lee la lista de pagadores de la cadena en cada llamada a propósito: es un
 * `eth_call` barato y la alternativa —cachearla— abre la puerta a sentar a
 * alguien con una foto vieja de quién había pagado.
 */
export async function requireSeat(
  identity: AppIdentity,
  room: RoomTerms,
  action: SeatAction
): Promise<{ ok: true } | { response: NextResponse }> {
  const escrowed = escrowEnabled();
  const onchainPlayers = escrowed
    ? await paidPlayersOf(tableIdFor(room.code, room.entryUnits, room.maxPlayers))
    : [];

  const verdict = decideSeatAccess({
    escrowed,
    identity,
    onchainPlayers,
    action,
  });
  if (verdict.ok) return { ok: true };

  return {
    response: NextResponse.json(
      { error: verdict.error },
      { status: STATUS[verdict.error] ?? 403 }
    ),
  };
}

/**
 * Lo mismo pero partiendo del código de sala, que es lo que traen las rutas.
 *
 * Si la sala no existe, deja pasar: el 404 lo da la ruta con su propio mensaje,
 * y adelantarlo aquí convertiría "esa sala no existe" en "no tienes silla", que
 * es más confuso y encima filtra menos información útil.
 */
export async function guardRoomSeat(
  identity: AppIdentity,
  code: string,
  action: SeatAction
): Promise<{ ok: true } | { response: NextResponse }> {
  if (!escrowEnabled()) return { ok: true };

  const room = await getRoomByCode(code);
  if (!room) return { ok: true };

  return await requireSeat(
    identity,
    {
      code: room.code,
      entryUnits: BigInt(room.entry_units),
      maxPlayers: room.max_players,
    },
    action
  );
}

/**
 * Levantarse de una mesa con entrada NO puede ser un botón.
 *
 * El contrato le paga al que se queda, así que "irse" es regalar la entrada. Un
 * botón que regala dinero es exactamente lo que no puede estar al alcance de
 * una sesión robada. Ausentarse sigue siendo posible —basta con dejar de
 * aparecer, y el servidor lo declara pasado el tiempo de gracia—, pero eso no
 * lo puede provocar un tercero desde fuera.
 */
export function forfeitBlocked(): { response: NextResponse } | null {
  if (!escrowEnabled()) return null;
  return {
    response: NextResponse.json(
      { error: "forfeit_not_allowed_on_paid_table" },
      { status: 403 }
    ),
  };
}
