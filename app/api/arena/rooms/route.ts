import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { ARENA_ENTRY_UNITS, ARENA_PLAYER_OPTIONS } from "@/lib/arena";
import { parseCardsPerPlayer } from "@/lib/arena-deck";
import { createRoom } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";

export const dynamic = "force-dynamic";

/**
 * POST /api/arena/rooms — arma una sala privada.
 *
 * Aquí se valida ESTRICTO, no se corrige. Es la diferencia con la URL de la
 * pantalla: un enlace raro se puede interpretar con los valores por defecto,
 * porque un enlace no es una orden, pero un cuerpo de API que pide una mesa que
 * no existe está pidiendo algo que no le vamos a dar en otra forma. Se rechaza
 * con 400 y quien lo mandó se entera.
 *
 * Lo que se comprueba: que la entrada sea una de las tres reales, que el número
 * de jugadores sea uno de los tres reales, y que las cartas por jugador sean un
 * entero que QUEPA en el mazo para ese número de jugadores. Nada de esto confía
 * en lo que dijera la pantalla, y nada se corrige en silencio: `40` cartas para
 * cuatro jugadores se rechaza, no se recorta a 13.
 *
 * No cobra nada. Crear la sala no mueve USDT ni bloquea fondos.
 */
export async function POST(req: Request) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);

  const entryUnits = ARENA_ENTRY_UNITS.find(
    (u) => u.toString() === String(body?.entry ?? "")
  );
  const maxPlayers = (ARENA_PLAYER_OPTIONS as readonly number[]).find(
    (n) => n === Number(body?.players)
  );
  // El límite depende del número de jugadores, así que se valida DESPUÉS de
  // saber cuántos son: 27 es legal para dos y no para cuatro.
  const cardsPerPlayer = maxPlayers
    ? parseCardsPerPlayer(body?.cards, maxPlayers)
    : null;

  if (!entryUnits || !maxPlayers || !cardsPerPlayer) {
    return NextResponse.json({ error: "invalid_setup" }, { status: 400 });
  }

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await createRoom({
      profileId: profile.id,
      entryUnits,
      maxPlayers,
      cardsPerPlayer,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "invalid_setup" ? 400 : 500 }
      );
    }
    return NextResponse.json({ code: result.value.code });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
