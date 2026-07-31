import { NextResponse } from "next/server";
import { optionalIdentity } from "@/lib/http";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { readRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/arena/rooms/[code] — el estado de la sala tal como se pinta.
 *
 * Sin sesión también responde: quien recibe el enlace por chat ve la mesa (la
 * entrada, cuánta gente falta) antes de decidir si entra. Lo que cambia con
 * sesión es `you`, y que la lectura cuenta como LATIDO: el cliente pregunta por
 * la sala cada pocos segundos de todos modos, así que ese mismo GET refresca su
 * `last_seen_at`. Es un efecto secundario en un GET a conciencia — la
 * alternativa era duplicar las peticiones para decir "sigo aquí".
 */
export async function GET(req: Request, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  try {
    const identity = await optionalIdentity(req);
    const profile = identity ? await ensureProfile(identity) : null;
    const result = await readRoom({
      code,
      viewerProfileId: profile?.id ?? null,
      touch: true,
    });
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
