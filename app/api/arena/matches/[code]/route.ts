import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { seatAddressFor } from "@/lib/arena-guard";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { readMatch } from "@/lib/supabase/arena-matches";
import { getRoomByCode } from "@/lib/supabase/arena-rooms";
import { seatProfileOf } from "@/lib/supabase/arena-escrow-db";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/arena/matches/[code] — el estado autoritativo de la partida.
 *
 * Hay que saber quién pregunta, a diferencia de la sala: aquí la respuesta
 * incluye TU carta. Un desconocido con el código no tiene nada que ver en una
 * partida ajena.
 *
 * Quién eres lo dice la FICHA de silla en una mesa con entrada, y la sesión en
 * una gratis — la misma regla que gobierna mover y confirmar
 * (`arena-actor.ts`). Aquí importaba tanto como allí: mientras esto pidió
 * sesión, un jugador que hubiera pagado y perdido la suya se quedaba sin ver su
 * propia mano, que es otra forma de no poder jugar una silla ya pagada.
 *
 * La lectura vale también como latido: el cliente pregunta cada segundo, y ese
 * mismo GET dice "sigo aquí". Sin eso no habría forma de distinguir a quien
 * está pensando de quien se quedó sin señal.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  try {
    const room = await getRoomByCode(code);
    const seatAddress = seatAddressFor(req, room?.table_id ?? null);

    let viewerProfileId: string | null = null;
    if (room && seatAddress) {
      viewerProfileId = await seatProfileOf(room.id, seatAddress);
    }
    // Sin ficha útil, la sesión. Es el camino de las mesas gratis, y también el
    // de una ficha vencida en una mesa paga: por ahí solo se ve la mano de un
    // perfil que ya está en la partida, y para MOVER sigue haciendo falta la
    // ficha.
    if (!viewerProfileId) {
      const auth = await requireIdentity(req);
      if ("response" in auth) return auth.response;
      viewerProfileId = (await ensureProfile(auth.identity)).id;
    }

    const result = await readMatch({ code, viewerProfileId, touch: true });
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
