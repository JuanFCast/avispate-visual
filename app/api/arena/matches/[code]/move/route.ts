import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { applyMove } from "@/lib/supabase/arena-matches";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/arena/matches/[code]/move — un toque.
 *
 * El cliente no dice "acerté": dice qué símbolo tocó, contra qué base creía
 * estar jugando (`seq`) y qué carta creía tener (`card`). Quién acertó lo
 * decide el servidor con el mazo, que el navegador no conoce entero.
 *
 * La respuesta trae la partida completa y recién leída, así que quien tocó ve
 * el resultado sin esperar al siguiente latido.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const seq = Number(body?.seq);
  const card = Number(body?.card);
  const symbolId = String(body?.symbolId ?? "");
  if (!Number.isInteger(seq) || !Number.isInteger(card) || !symbolId) {
    return NextResponse.json({ error: "bad_move" }, { status: 400 });
  }

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await applyMove({
      code,
      profileId: profile.id,
      seq,
      card,
      symbolId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "no_match" ? 404 : 403 }
      );
    }
    return NextResponse.json(result.value);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
