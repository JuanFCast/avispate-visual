import { NextResponse } from "next/server";
import { optionalIdentity } from "@/lib/http";
import { seatAddressFor } from "@/lib/arena-guard";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { getRoomByCode, readRoom } from "@/lib/supabase/arena-rooms";
import { seatProfileOf } from "@/lib/supabase/arena-escrow-db";
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
 *
 * En una mesa con entrada, quién eres lo dice la FICHA de silla antes que la
 * sesión, por lo mismo que en las rutas que actúan (`arena-actor.ts`). Si aquí
 * mandara la sesión, un jugador cuyo perfil no coincidiera con la wallet que
 * pagó vería su propia mesa como si no estuviera sentado —sin `you`, sin botón
 * de listo y con el de pagar delante— y su latido no refrescaría nada.
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

    // La ficha primero; la sesión solo si no hay ficha que valga. Se pide una u
    // otra, no las dos: sin ficha útil no hay nada que buscar por wallet, y con
    // ella la sesión no aporta.
    let viewerProfileId: string | null = null;
    if (room && seatAddress) {
      viewerProfileId = await seatProfileOf(room.id, seatAddress);
    }
    if (!viewerProfileId) {
      const identity = await optionalIdentity(req);
      const profile = identity ? await ensureProfile(identity) : null;
      viewerProfileId = profile?.id ?? null;
    }

    const result = await readRoom({ code, viewerProfileId, touch: true });
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
