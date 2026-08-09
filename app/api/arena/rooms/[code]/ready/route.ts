import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/arena-actor";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { setReady } from "@/lib/supabase/arena-rooms";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

const STATUS: Record<string, number> = {
  room_not_found: 404,
  room_closed: 410,
  not_in_room: 403,
};

/**
 * POST /api/arena/rooms/[code]/ready — el jugador se marca (o se desmarca)
 * como listo. Devuelve la sala completa para que quien tocó el botón vea el
 * cambio sin esperar al siguiente latido.
 *
 * En una mesa con entrada quien se marca listo es la WALLET que probó la ficha
 * de silla, no el perfil de la sesión: el porqué está en `arena-actor.ts`.
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
  const ready = body?.ready !== false;

  try {
    const result = await setReady({
      code,
      profileId: resolved.actor.profileId,
      ready,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: STATUS[result.error] ?? 500 }
      );
    }
    return NextResponse.json(result.value);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
