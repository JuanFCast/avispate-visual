import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { readMatch } from "@/lib/supabase/arena-matches";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/arena/matches/[code] — el estado autoritativo de la partida.
 *
 * Pide sesión, a diferencia de la sala: aquí la respuesta incluye TU carta, y
 * para saber cuál es hay que saber quién pregunta. Un desconocido con el código
 * no tiene nada que ver en una partida ajena.
 *
 * La lectura vale también como latido: el cliente pregunta cada segundo, y ese
 * mismo GET dice "sigo aquí". Sin eso no habría forma de distinguir a quien
 * está pensando de quien se quedó sin señal.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await readMatch({
      code,
      viewerProfileId: profile.id,
      touch: true,
    });
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
