import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { guardRoomSeat } from "@/lib/arena-guard";
import { getRoomByCode } from "@/lib/supabase/arena-rooms";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { isPlayableTable } from "@/lib/arena";
import { startMatch } from "@/lib/supabase/arena-matches";
import { ensureProfile } from "@/lib/supabase/profiles";

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
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const code = normalizeRoomCode(String(body?.code ?? ""));
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // Empezar la partida es una acción de silla: solo desde una pagada.
  const seat = await guardRoomSeat(req, code, "act");
  if ("response" in seat) return seat.response;

  try {
    const profile = await ensureProfile(auth.identity);

    // Hoy las tres mesas se pueden jugar, pero el freno se queda: es el borde
    // donde de verdad se decide, y lo que hoy dice "sí a las tres" es una lista
    // de una sola línea que mañana puede volver a cerrar una.
    const room = await getRoomByCode(code);
    if (room && !isPlayableTable(room.max_players)) {
      return NextResponse.json({ error: "table_too_big" }, { status: 409 });
    }

    const result = await startMatch({ code, hostProfileId: profile.id });
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
