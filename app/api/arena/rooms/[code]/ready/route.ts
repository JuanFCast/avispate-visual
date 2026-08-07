import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { guardRoomSeat } from "@/lib/arena-guard";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { setReady } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

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
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // Actuar sobre una silla de una mesa con entrada exige haberla pagado.
  const seat = await guardRoomSeat(auth.identity, code, "act");
  if ("response" in seat) return seat.response;

  const body = await req.json().catch(() => null);
  const ready = body?.ready !== false;

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await setReady({ code, profileId: profile.id, ready });
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
