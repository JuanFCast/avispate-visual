import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { findActiveRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

/**
 * GET /api/arena/rooms/active — la sala en la que el jugador sigue sentado.
 *
 * Es lo que hace que cerrar la app, volver y abrir "Sala privada" no empiece de
 * cero: la mesa vive en el servidor, no en la pestaña. Devuelve `null` cuando
 * no hay ninguna, que es la respuesta normal, no un error.
 */
export async function GET(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  try {
    const profile = await ensureProfile(auth.identity);
    return NextResponse.json({ code: await findActiveRoom(profile.id) });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
