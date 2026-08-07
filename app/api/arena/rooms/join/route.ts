import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { guardRoomSeat } from "@/lib/arena-guard";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { joinRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

/** Qué respuesta HTTP merece cada negativa: la pantalla las distingue. */
const STATUS: Record<string, number> = {
  invalid_code: 400,
  room_not_found: 404,
  room_closed: 410,
  room_full: 409,
};

/**
 * POST /api/arena/rooms/join — sienta al jugador en una sala por su código.
 *
 * El código se normaliza aquí también: quien escribe `4821` en el teléfono y
 * quien pega `AVP-4821` de un chat entran a la misma mesa.
 */
export async function POST(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const code = normalizeRoomCode(String(body?.code ?? ""));
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // La silla de una mesa con entrada la da el contrato, no esta sesión.
  const seat = await guardRoomSeat(req, code, "join");
  if ("response" in seat) return seat.response;

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await joinRoom({ profileId: profile.id, code });
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
