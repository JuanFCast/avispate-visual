import { NextResponse } from "next/server";
import { optionalIdentity } from "@/lib/http";
import { decideRoomCreation, mayLeaveOtherRooms } from "@/lib/arena-create";
import { escrowConfigured } from "@/lib/arena-escrow";
import { ensureProfileByWallet } from "@/lib/supabase/profiles";
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
  const body = await req.json().catch(() => null);

  /**
   * Crear una sala NO exige sesión cuando la mesa va a cobrar entrada.
   *
   * Porque crear no otorga nada: ni silla, ni permiso para jugar, ni un
   * centavo. La silla la crea el pago on-chain y las acciones las gobierna la
   * ficha. Exigir identidad aquí solo servía para obligar a jugar una partida
   * del reto antes de montar una mesa dentro de MiniPay, que es donde no se
   * puede firmar un mensaje.
   *
   * En las salas gratis la sesión sigue siendo obligatoria: allí sentarse no
   * cuesta nada y sin identidad cualquiera ocuparía cualquier mesa.
   */
  const identity = await optionalIdentity(req);
  const verdict = decideRoomCreation({
    identity,
    escrowed: escrowConfigured(),
    claimedAddress: typeof body?.address === "string" ? body.address : null,
  });
  if (verdict.kind === "denied") {
    return NextResponse.json(
      { error: verdict.error },
      { status: verdict.error === "unauthorized" ? 401 : 400 }
    );
  }

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

  // `entryUnits` es bigint y `0n` es falsy: con `!entryUnits` una entrada de
  // cero se leería como "no vino ninguna". Hoy no muerde porque la mínima es
  // 100_000n, pero el día de una mesa gratis sí, y sería un fallo silencioso
  // en el camino del dinero. Se compara contra ausencia, no contra verdad.
  if (entryUnits === undefined || !maxPlayers || !cardsPerPlayer) {
    return NextResponse.json({ error: "invalid_setup" }, { status: 400 });
  }

  try {
    /**
     * A quién se le atribuye la sala. Con sesión, a quien la abrió. Sin ella,
     * al perfil de la dirección que dijo traer — un dato SIN PROBAR, y da
     * igual: la sala no otorga nada y quien acabe sentado será quien pague.
     */
    const profile =
      verdict.kind === "session"
        ? await ensureProfile(identity!)
        : await ensureProfileByWallet(verdict.address);

    const result = await createRoom({
      profileId: profile.id,
      // Sacar a alguien de sus otras salas por una dirección que nadie probó
      // sería regalar una forma de echar a otro de su partida.
      leaveOthers: mayLeaveOtherRooms(verdict),
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
