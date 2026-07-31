import { NextResponse } from "next/server";
import { roundClosesAt, roundIdAt } from "@/lib/round-time";

export const dynamic = "force-dynamic";

const DECK_SIZES = [10, 15, 20];

/**
 * GET /api/round?deck=10 — contrato de tiempo de la ronda. Es la fuente de
 * verdad del contador: el cliente no decide cuándo cambia la ronda, solo
 * dibuja lo que aquí se le dice.
 *
 *   roundId   ronda ABIERTA ahora mismo
 *   serverNow reloj del servidor, para corregir teléfonos desajustados
 *   closesAt  instante universal en que `roundId` cierra
 *
 * Responde SIEMPRE la ronda abierta. La pantalla de inicio es el sitio donde
 * se juega, y a las 7:00:00 p. m. la ronda del día siguiente ya está abierta
 * y aceptando jugadas: el instante en que una ronda cierra es el mismo en que
 * empieza la otra, sin hueco entre medias. Enseñar ahí al ganador de ayer
 * tapaba el pozo y el contador de hoy con algo que ya es historia — el ganador
 * vive en /historial, que es su sitio.
 *
 * Sin base de datos: esto es aritmética sobre el reloj. Una liquidación lenta
 * no puede retrasar ni ensuciar lo que ve el jugador, porque esta respuesta ni
 * siquiera mira `round_settlements`.
 *
 * Lectura pública, sin sesión. Sin caché: `serverNow` debe ser real.
 */
export async function GET(req: Request) {
  const deck = Number(new URL(req.url).searchParams.get("deck") ?? 10);
  if (!DECK_SIZES.includes(deck)) {
    return NextResponse.json({ error: "invalid_deck_size" }, { status: 400 });
  }

  const now = Date.now();
  return NextResponse.json(
    {
      roundId: roundIdAt(now),
      deck,
      serverNow: new Date(now).toISOString(),
      closesAt: new Date(roundClosesAt(now)).toISOString(),
      status: "open" as const,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
