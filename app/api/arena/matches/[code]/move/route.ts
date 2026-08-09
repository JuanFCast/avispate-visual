import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/arena-actor";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { applyMove } from "@/lib/supabase/arena-matches";

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
 *
 * En una mesa con entrada quien mueve es la WALLET que probó la ficha de silla,
 * no el perfil de la sesión: el porqué está en `arena-actor.ts`.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // Actuar sobre una silla de una mesa con entrada exige haberla pagado, y se
  // actúa como esa silla.
  const resolved = await resolveActor(req, code, "act");
  if ("response" in resolved) return resolved.response;

  const body = await req.json().catch(() => null);
  const seq = Number(body?.seq);
  const card = Number(body?.card);
  const symbolId = String(body?.symbolId ?? "");
  if (!Number.isInteger(seq) || !Number.isInteger(card) || !symbolId) {
    return NextResponse.json({ error: "bad_move" }, { status: 400 });
  }

  try {
    const result = await applyMove({
      code,
      profileId: resolved.actor.profileId,
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
