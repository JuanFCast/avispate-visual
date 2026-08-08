import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { findActiveRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

/**
 * GET /api/arena/rooms/active — la sala en la que el jugador sigue sentado.
 *
 * Es lo que hace que cerrar la app, volver y abrir "Sala privada" no empiece de
 * cero: la mesa vive en el servidor, no en la pestaña. Devuelve `code: null`
 * cuando no hay ninguna, que es la respuesta normal, no un error.
 *
 * `inMatch` distingue la mesa que espera gente de la partida que ya empezó: son
 * dos avisos distintos y llevan a dos sitios distintos.
 */
export async function GET(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  try {
    const profile = await ensureProfile(auth.identity);
    const active = await findActiveRoom(profile.id);
    return NextResponse.json({
      code: active?.code ?? null,
      inMatch: active?.inMatch ?? false,
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
