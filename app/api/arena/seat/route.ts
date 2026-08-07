import { NextResponse } from "next/server";
import { keccak256 } from "viem";
import { getRoomByCode } from "@/lib/supabase/arena-rooms";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { seatCommitmentOf, escrowConfigured } from "@/lib/arena-escrow";
import { signSeatToken, seatTokensEnabled } from "@/lib/seat-token";

export const dynamic = "force-dynamic";

const ADDR_RE = /^0x[0-9a-f]{40}$/i;
const SECRET_RE = /^0x[0-9a-f]{64}$/i;

/**
 * POST /api/arena/seat — canjea el secreto de la silla por su ficha.
 *
 * Es el único sitio donde el secreto viaja, y viaja una vez. Lo que se
 * comprueba es esto: la huella que quedó en la CADENA cuando esa dirección pagó
 * tiene que ser la de este secreto. Nadie más puede pasar ese cheque, porque la
 * huella es pública pero el secreto no se deduce de ella — que es justo lo que
 * permite probar la silla en MiniPay, donde no se puede firmar un mensaje.
 *
 * No pide sesión. No la necesita y sería peor pedirla: la silla no es de una
 * cuenta, es de una dirección que pagó, y mezclar las dos cosas es exactamente
 * el error que este mecanismo existe para no cometer. Lo que se devuelve
 * tampoco es una sesión — es un permiso para una mesa y punto (`seat-token.ts`).
 */
export async function POST(req: Request) {
  if (!escrowConfigured()) {
    return NextResponse.json({ error: "escrow_disabled" }, { status: 503 });
  }
  if (!seatTokensEnabled()) {
    return NextResponse.json({ error: "seat_tokens_disabled" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const code = normalizeRoomCode(String(body?.code ?? ""));
  const address = String(body?.address ?? "");
  const secret = String(body?.secret ?? "");

  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }
  if (!ADDR_RE.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  // El formato se valida antes de tocar la cadena: un secreto con otra forma no
  // puede coincidir con ninguna huella, y así no se gasta una lectura.
  if (!SECRET_RE.test(secret)) {
    return NextResponse.json({ error: "invalid_secret" }, { status: 400 });
  }

  try {
    const room = await getRoomByCode(code);
    if (!room) {
      return NextResponse.json({ error: "room_not_found" }, { status: 404 });
    }

    // La mesa se identifica por el código Y por sus términos: así una sala con
    // otra entrada es otra mesa y no hay forma de canjear una silla cruzada.
    // La mesa la dice la SALA, no un cálculo: es lo que fija si esta sala cobra
    // y cuál es su mesa, y no cambia aunque cambie la configuración.
    const tableId = room.table_id as `0x${string}` | null;
    if (!tableId) {
      return NextResponse.json({ error: "room_is_free" }, { status: 409 });
    }

    const onchain = await seatCommitmentOf(tableId, address);
    if (!onchain) {
      // O no pagó, o la cadena no contestó. Las dos se responden igual: sin
      // huella comprobada no hay ficha, y distinguirlas le diría a quien
      // sondea si esa dirección está sentada en esta mesa.
      return NextResponse.json({ error: "seat_not_found" }, { status: 403 });
    }

    if (keccak256(secret as `0x${string}`).toLowerCase() !== onchain.toLowerCase()) {
      return NextResponse.json({ error: "wrong_secret" }, { status: 403 });
    }

    return NextResponse.json({
      token: signSeatToken({ tableId, address }),
      tableId,
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
