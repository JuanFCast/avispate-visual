import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { ARENA_ENTRY_UNITS, ARENA_PLAYER_OPTIONS } from "@/lib/arena";
import { isDealValid, parseDeckMode } from "@/lib/arena-deck";
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
 * de jugadores sea uno de los tres reales, que el modo de cartas exista, y que
 * la combinación de los dos últimos quepa en el mazo (`isDealValid`). Nada de
 * esto confía en lo que dijera la pantalla.
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
  const deckMode = parseDeckMode(body?.cards);

  if (!entryUnits || !maxPlayers || !deckMode) {
    return NextResponse.json({ error: "invalid_setup" }, { status: 400 });
  }
  if (!isDealValid(deckMode, maxPlayers)) {
    return NextResponse.json({ error: "invalid_setup" }, { status: 400 });
  }

  try {
    const profile = await ensureProfile(auth.identity);
    const result = await createRoom({
      profileId: profile.id,
      entryUnits,
      maxPlayers,
      deckMode,
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
