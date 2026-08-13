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
 *
 * Cuando deja pasar devuelve la DIRECCIÓN que la ficha probó (o `null` en una
 * sala gratis, donde no hay ninguna que probar). No es un detalle: en una mesa
 * con entrada esa dirección es quien actúa —ver `arena-actor.ts`—, así que
 * quien pregunta necesita recibirla y no volver a deducirla por su cuenta.
 */
export async function requireSeat(
  req: Request,
  room: RoomTerms,
  action: SeatAction
): Promise<{ ok: true; address: string | null } | { response: NextResponse }> {
  const tableId = room.tableId;
  // Sala gratis: nada que proteger, todo sigue como estaba.
  if (!tableId) return { ok: true, address: null };

  const raw = req.headers.get(SEAT_HEADER);
  const seat = raw ? verifySeatToken(raw.trim()) : null;

  const verdict = decideSeatAccess({
    escrowed: true,
    tableId,
    seat,
    onchainPlayers: await paidPlayersOf(tableId as `0x${string}`),
    action,
  });
  // `seat` no es null cuando el veredicto es favorable: `decideSeatAccess`
  // rechaza antes de mirar nada más si la ficha no vino.
  if (verdict.ok) return { ok: true, address: seat?.address ?? null };

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
): Promise<{ ok: true; address: string | null } | { response: NextResponse }> {
  const room = await getRoomByCode(code);
  // Sala inexistente o gratis: el 404 lo da la ruta con su propio mensaje.
  if (!room || !roomIsEscrowed(room)) return { ok: true, address: null };

  return await requireSeat(req, { tableId: room.table_id ?? null }, action);
}

/**
 * La dirección de la ficha, mirando solo la firma y la mesa. Sin cadena.
 *
 * Es para LEER, no para actuar. La diferencia importa: `requireSeat` pregunta
 * además al contrato quién pagó, y eso es un acierto en una acción y un
 * desperdicio en una lectura que el cliente repite cada pocos segundos como
 * latido. Para saber cuál de las sillas pintadas es la tuya basta con que la
 * ficha esté bien firmada por nosotros y sea de esta mesa: no abre ningún
 * permiso, solo dice a quién se está mirando.
 */
export function seatAddressFor(req: Request, tableId: string | null): string | null {
  if (!tableId) return null;
  const raw = req.headers.get(SEAT_HEADER);
  const seat = raw ? verifySeatToken(raw.trim()) : null;
  if (!seat) return null;
  return seat.tableId.toLowerCase() === tableId.toLowerCase() ? seat.address : null;
}

/**
 * Levantarse del LOBBY de una mesa con entrada, antes de que arranque la
 * partida, sigue sin ser un botón.
 *
 * Ojo: esto ya NO se usa para abandonar una partida en curso — ese camino
 * ahora es `leaveMatch` con `resolveActor` (misma ficha de silla que exige
 * `move`), porque la pregunta "¿quién puede irse?" tiene la misma respuesta
 * que "¿quién puede jugar?" y no hace falta un interruptor aparte. Aquí, en
 * el lobby, la partida ni empezó: no hay mazo, ni mano, ni forma de que
 * `closeIfAbandoned` reparta la silla vacía entre los que quedan, así que
 * sigue sin haber una salida limpia que no sea "espera a que la mesa venza o
 * se anule".
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
