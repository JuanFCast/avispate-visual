import { NextResponse } from "next/server";
import { requireIdentity } from "./http";
import { requireSeat } from "./arena-guard";
import { decideActor, type ActorRefusal } from "./arena-seat";
import { getRoomByCode, type RoomRow } from "./supabase/arena-rooms";
import { seatProfileOf } from "./supabase/arena-escrow-db";
import { ensureProfile } from "./supabase/profiles";

/**
 * Resolver quién actúa sobre una sala: la parte que habla HTTP y base de datos.
 *
 * **La regla vive en `arena-seat.ts` (`decideActor`), no aquí**, y esa
 * separación es a propósito: este archivo importa `next/server`, así que todo
 * lo que viva en él queda fuera del alcance de un `node scripts/verify-*.ts`.
 * Una regla que decide quién puede jugar una silla pagada tiene que poder
 * correrse sola, sin servidor. Aquí solo se juntan los ingredientes.
 */

const STATUS: Record<ActorRefusal, number> = {
  unauthorized: 401,
  seat_not_registered: 409,
};

export interface Actor {
  /** Con qué perfil se actúa sobre las filas de la sala. */
  profileId: string;
  /**
   * La sala, ya leída, para no volver a pedirla en la ruta. `null` si no
   * existe: es la ruta la que da ese 404, con su propio mensaje.
   */
  room: RoomRow | null;
  /** La dirección que probó la ficha, o `null` en una mesa gratis. */
  address: string | null;
}

/**
 * Resuelve quién actúa, comprobando por el camino el permiso de la silla.
 *
 * Sustituye al par `requireIdentity` + `guardRoomSeat` en las rutas que ACTÚAN
 * sobre una sala. Las dos comprobaciones estaban ya, pero separadas: una decía
 * quién eres y la otra si podías tocar la silla, y en medio quedaba el hueco de
 * actuar con el perfil de la sesión sobre una silla que no era de ese perfil.
 *
 * Si la sala no existe deja pasar con el perfil de la sesión (o `unauthorized`
 * si tampoco la hay): el 404 lo da la ruta con su propio mensaje, igual que
 * hacía `guardRoomSeat`.
 */
export async function resolveActor(
  req: Request,
  code: string,
  action: "join" | "act"
): Promise<{ actor: Actor } | { response: NextResponse }> {
  const room = await getRoomByCode(code);
  const escrowed = Boolean(room?.table_id);

  // La ficha primero: en una mesa con entrada es la única autoridad, y si no
  // vale no hay por qué molestar a Privy ni tocar la tabla de perfiles.
  const seat = await requireSeat(req, { tableId: room?.table_id ?? null }, action);
  if ("response" in seat) return seat;

  // La sesión solo se pide donde puede decidir algo. En una mesa con entrada ni
  // se mira: pedirla sería volver a meterla en un camino del que acaba de
  // salir, y un 401 suyo volvería a dejar fuera a quien ya pagó.
  let sessionProfileId: string | null = null;
  if (!escrowed) {
    const auth = await requireIdentity(req);
    if ("response" in auth) return auth;
    sessionProfileId = (await ensureProfile(auth.identity)).id;
  }

  const seatProfileId =
    escrowed && room && seat.address
      ? await seatProfileOf(room.id, seat.address)
      : null;

  const verdict = decideActor({ escrowed, sessionProfileId, seatProfileId });
  if (!verdict.ok) {
    return {
      response: NextResponse.json(
        { error: verdict.error },
        { status: STATUS[verdict.error] }
      ),
    };
  }

  return {
    actor: { profileId: verdict.profileId, room, address: seat.address },
  };
}
