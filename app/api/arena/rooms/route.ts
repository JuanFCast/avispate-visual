import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { parseEntry, parsePlayers } from "@/lib/arena";
import { createRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

/**
 * POST /api/arena/rooms — arma una sala privada con la mesa elegida en el lobby.
 *
 * La entrada y el número de jugadores llegan del cliente pero se vuelven a
 * validar aquí contra las opciones reales: un `entry=999999999` en la URL no
 * puede convertirse en una mesa que promete un pozo que no existe.
 *
 * No cobra nada. Crear la sala no mueve USDT ni bloquea fondos: la entrada es
 * el acuerdo de la mesa, y el cobro llega en la fase del contrato.
 */
export async function POST(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const entryUnits = parseEntry(body?.entry ? String(body.entry) : undefined);
  const maxPlayers = parsePlayers(body?.players ? String(body.players) : undefined);

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await createRoom({
      profileId: profile.id,
      entryUnits,
      maxPlayers,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ code: result.value.code });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
