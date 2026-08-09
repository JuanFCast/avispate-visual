import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/arena-actor";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { isPlayableTable } from "@/lib/arena";
import { startMatch } from "@/lib/supabase/arena-matches";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  no_match: 404,
  not_host: 403,
  room_not_ready: 409,
  // Los tres motivos por los que la mesa no está para repartir. 409 y no 400:
  // la petición está bien formada, lo que pasa es que ahora mismo no procede.
  room_not_full: 409,
  players_not_ready: 409,
  seats_not_paid: 409,
  room_closed: 409,
  table_too_big: 409,
};

/**
 * POST /api/arena/matches — el anfitrión reparte.
 *
 * Que la mesa esté llena y todos listos se vuelve a comprobar aquí: el botón
 * deshabilitado de la pantalla es una cortesía para el jugador, no una regla.
 *
 * Es idempotente. Tocar dos veces, o reintentar tras un timeout, devuelve la
 * misma partida — repartir dos mazos sería peor que no repartir ninguno.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = normalizeRoomCode(String(body?.code ?? ""));
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // Empezar la partida es una acción de silla: solo desde una pagada, y se
  // actúa como esa silla.
  const resolved = await resolveActor(req, code, "act");
  if ("response" in resolved) return resolved.response;

  try {
    // Hoy las tres mesas se pueden jugar, pero el freno se queda: es el borde
    // donde de verdad se decide, y lo que hoy dice "sí a las tres" es una lista
    // de una sola línea que mañana puede volver a cerrar una.
    const room = resolved.actor.room;
    if (room && !isPlayableTable(room.max_players)) {
      return NextResponse.json({ error: "table_too_big" }, { status: 409 });
    }

    const result = await startMatch({
      code,
      actorProfileId: resolved.actor.profileId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: STATUS[result.error] ?? 500 }
      );
    }
    return NextResponse.json({ code: result.value.code });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
