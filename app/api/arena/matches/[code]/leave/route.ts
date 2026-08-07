import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { forfeitBlocked } from "@/lib/arena-guard";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { leaveMatch } from "@/lib/supabase/arena-matches";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/arena/matches/[code]/leave — abandonar.
 *
 * El que se queda gana ahí mismo. No hay a quién esperar, y dejar la partida
 * abierta solo serviría para que el otro mire una carta que nadie va a
 * responder.
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
  const blocked = await forfeitBlocked(code);
  if (blocked) return blocked.response;

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await leaveMatch({ code, profileId: profile.id });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "no_match" ? 404 : 500 }
      );
    }
    return NextResponse.json(result.value);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
