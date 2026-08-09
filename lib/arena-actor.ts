import { NextResponse } from "next/server";
import { requireIdentity } from "./http";
import { requireSeat } from "./arena-guard";
import { getRoomByCode, type RoomRow } from "./supabase/arena-rooms";
import { seatProfileOf } from "./supabase/arena-escrow-db";
import { ensureProfile } from "./supabase/profiles";

/**
 * Quién está actuando sobre una sala, y por qué autoridad.
 *
 * ── La regla, acordada el 2026-08-08 ───────────────────────────────────────
 *
 * **En una mesa con entrada manda la wallet que probó la ficha de silla, no el
 * perfil de la sesión.** La silla la paga una dirección y la prueba un secreto
 * que solo su dueño tiene; la sesión no participa en ninguna de las dos cosas.
 *
 * Es la mitad que faltaba de la decisión de `/rooms/[code]/paid`. Registrar la
 * silla dejó de necesitar sesión, pero si JUGARLA seguía dependiendo de
 * `profile_id`, el problema solo se movía de sitio: un jugador de Privy cuyo
 * perfil no tuviera escrita la dirección con la que pagó acababa con la silla
 * en un perfil y la sesión en otro, registrado y sin poder tocar el botón de
 * listo. Pagó, y la aplicación no lo reconoce. Ese final es el que no puede
 * existir.
 *
 * Así que en una mesa con entrada el perfil sale de la SILLA: se busca la fila
 * cuya `wallet_address` es la que la ficha probó, y se actúa como ella. El
 * perfil pasa a ser lo que siempre debió ser aquí —una etiqueta para el alias y
 * las estadísticas— y deja de gobernar el permiso. Ni un fallo de Privy ni dos
 * perfiles de la misma persona pueden interponerse: ninguno de los dos entra en
 * la decisión.
 *
 * En una mesa gratis no hay ficha ni dirección que probar, así que manda la
 * sesión, exactamente como hasta hoy.
 */

export type ActorRefusal =
  /** Mesa gratis sin sesión válida. */
  | "unauthorized"
  /**
   * Mesa con entrada: la ficha vale, pero de esa dirección no consta silla.
   * Es "termina de registrar el pago", no "no tienes permiso" — y por eso es
   * un 409 y no un 403: la respuesta es reintentar `/paid`, que no cobra nada.
   */
  | "seat_not_registered";

export type ActorVerdict =
  | { ok: true; profileId: string }
  | { ok: false; error: ActorRefusal };

/**
 * La decisión, sin red ni base de datos, para poder correrla entera desde
 * `scripts/verify-arena-actor.ts`.
 *
 * Lo que hay que leer aquí es lo que NO aparece: en el camino de una mesa con
 * entrada, `sessionProfileId` no se mira ni una vez. No es que se prefiera la
 * silla y se caiga a la sesión si falta — es que la sesión no puede decidir
 * quién juega una silla pagada, ni cuando existe ni cuando falta.
 */
export function decideActor(check: {
  /** ¿Esta sala cobra entrada? */
  escrowed: boolean;
  /** Perfil de la sesión, si vino y valía. Solo cuenta en mesas gratis. */
  sessionProfileId: string | null;
  /** Perfil dueño de la silla cuya dirección probó la ficha. */
  seatProfileId: string | null;
}): ActorVerdict {
  if (check.escrowed) {
    if (!check.seatProfileId) return { ok: false, error: "seat_not_registered" };
    return { ok: true, profileId: check.seatProfileId };
  }

  if (!check.sessionProfileId) return { ok: false, error: "unauthorized" };
  return { ok: true, profileId: check.sessionProfileId };
}

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
