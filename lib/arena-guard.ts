import { NextResponse } from "next/server";
import { paidPlayersOf, roomIsEscrowed } from "./arena-escrow";
import { decideSeatAccess, type SeatAction } from "./arena-seat";
import { getRoomByCode } from "./supabase/arena-rooms";
import { verifySeatToken } from "./seat-token";

/**
 * La ficha de silla viaja en su propia cabecera, NO en `Authorization`.
 *
 * Separarlas es a propósito: `Authorization` lleva la sesión (quién eres) y
 * esto lleva el permiso de una mesa (qué silla probaste). Mezclarlas invitaría
 * a que un día alguien acepte una donde va la otra, que es exactamente el
 * error que este mecanismo existe para no cometer.
 */
const SEAT_HEADER = "x-avispate-seat";

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
  seat_token_required: 403,
  seat_token_wrong_table: 403,
  seat_not_paid: 403,
};

export interface RoomTerms {
  /** La mesa en el contrato, o `null` si la sala es gratis. */
  tableId: string | null;
}

/**
 * Deja pasar, o devuelve la respuesta lista para retornar.
 *
 * Lee la lista de pagadores de la cadena en cada llamada a propósito: es un
 * `eth_call` barato y la alternativa —cachearla— abre la puerta a sentar a
 * alguien con una foto vieja de quién había pagado.
 */
export async function requireSeat(
  req: Request,
  room: RoomTerms,
  action: SeatAction
): Promise<{ ok: true } | { response: NextResponse }> {
  const tableId = room.tableId;
  // Sala gratis: nada que proteger, todo sigue como estaba.
  if (!tableId) return { ok: true };

  const raw = req.headers.get(SEAT_HEADER);
  const seat = raw ? verifySeatToken(raw.trim()) : null;

  const verdict = decideSeatAccess({
    escrowed: true,
    tableId,
    seat,
    onchainPlayers: await paidPlayersOf(tableId as `0x${string}`),
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
  req: Request,
  code: string,
  action: SeatAction
): Promise<{ ok: true } | { response: NextResponse }> {
  const room = await getRoomByCode(code);
  // Sala inexistente o gratis: el 404 lo da la ruta con su propio mensaje.
  if (!room || !roomIsEscrowed(room)) return { ok: true };

  return await requireSeat(req, { tableId: room.table_id ?? null }, action);
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
export async function forfeitBlocked(
  code: string
): Promise<{ response: NextResponse } | null> {
  const room = await getRoomByCode(code);
  if (!room || !roomIsEscrowed(room)) return null;
  return {
    response: NextResponse.json(
      { error: "forfeit_not_allowed_on_paid_table" },
      { status: 403 }
    ),
  };
}
