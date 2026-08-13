import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/arena-actor";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { leaveMatch } from "@/lib/supabase/arena-matches";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/arena/matches/[code]/leave — abandonar.
 *
 * En una mesa de dos, el que se queda gana ahí mismo — no hay a quién
 * esperar. En una de tres o cuatro, solo se elimina a quien se fue: la
 * partida sigue entre los demás hasta que quede uno de pie (`closeIfAbandoned`
 * decide eso, no esta ruta — ver `lib/arena-outcome.ts`).
 *
 * Quién puede marcarse a sí mismo como ido es la misma pregunta que quién
 * puede mover una carta: `resolveActor` exige la ficha de silla en una mesa
 * con entrada, así que nadie puede abandonar en nombre de otro con una sesión
 * robada, exactamente igual que no puede jugar en su nombre. Ya no hace falta
 * un bloqueo total del botón —eso era un sustituto de esta comprobación, no
 * un complemento— y sin firma ni transacción nueva: la ficha ya la tiene
 * guardada desde que se sentó.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const resolved = await resolveActor(req, code, "act");
  if ("response" in resolved) return resolved.response;

  try {
    const result = await leaveMatch({ code, profileId: resolved.actor.profileId });
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
