import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { startMatch } from "@/lib/supabase/arena-matches";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  no_match: 404,
  not_host: 403,
  room_not_ready: 409,
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

  try {
    const profile = await ensureProfile(auth.identity);
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
