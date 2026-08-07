import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { forfeitBlocked } from "@/lib/arena-guard";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { leaveRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/arena/rooms/[code]/leave — el jugador se levanta de la mesa.
 *
 * Si era el anfitrión la sala se cierra para todos: sin él no hay quién la
 * arranque, y los demás merecen enterarse en vez de esperar de balde.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // Irse de una mesa con entrada es regalar el pozo al que se queda: no puede
  // ser un botón al alcance de una sesión. Ausentarse sigue siendo posible.
  const blocked = forfeitBlocked();
  if (blocked) return blocked.response;

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await leaveRoom({ code, profileId: profile.id });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "room_not_found" ? 404 : 500 }
      );
    }
    return NextResponse.json(result.value);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
