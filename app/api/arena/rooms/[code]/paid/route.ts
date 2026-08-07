import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/http";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { getRoomByCode } from "@/lib/supabase/arena-rooms";
import { ensureProfile } from "@/lib/supabase/profiles";
import { escrowConfigured, verifyJoinTx } from "@/lib/arena-escrow";
import {
  nextFreeSeat,
  recordSeatPayment,
} from "@/lib/supabase/arena-escrow-db";

export const dynamic = "force-dynamic";

const TX_RE = /^0x[0-9a-f]{64}$/i;
const ADDR_RE = /^0x[0-9a-f]{40}$/i;

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/arena/rooms/[code]/paid — la silla ya está pagada; siéntame.
 *
 * Este es el paso que antes no existía. El orden completo de una mesa con
 * entrada es:
 *
 *   crear sala → ver el código → pagar `join` on-chain → ESTO → canjear la
 *   silla en `/api/arena/seat` → jugar
 *
 * Y el anfitrión no se salta ninguno: crear la mesa no lo sienta. No puede,
 * porque hasta que la sala no existe no hay código, y sin código no hay mesa
 * que pagar. Nadie se sienta sin pagar, tampoco quien montó la partida.
 *
 * La silla se crea aquí contra la CADENA: se lee del evento quién pagó, no se
 * le cree al navegador. Si la cadena dice otra dirección, el pago no se pierde
 * —está en el contrato a nombre de quien pagó— pero no se sienta a nadie: eso
 * lo tiene que reconciliar la persona, no nosotros adivinando.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireIdentity(req);
  if ("response" in auth) return auth.response;

  if (!escrowConfigured()) {
    return NextResponse.json({ error: "escrow_disabled" }, { status: 503 });
  }

  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const txHash = String(body?.txHash ?? "");
  const address = String(body?.address ?? "");
  if (!TX_RE.test(txHash)) {
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  }
  if (!ADDR_RE.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  try {
    const room = await getRoomByCode(code);
    if (!room) {
      return NextResponse.json({ error: "room_not_found" }, { status: 404 });
    }

    // La mesa la dice la SALA, no un cálculo: es lo que fija si esta sala cobra
    // y cuál es su mesa, y no cambia aunque cambie la configuración.
    const tableId = room.table_id as `0x${string}` | null;
    if (!tableId) {
      return NextResponse.json({ error: "room_is_free" }, { status: 409 });
    }

    // La cadena es la fuente de verdad sobre quién pagó y en qué mesa.
    const check = await verifyJoinTx(txHash, tableId, address);
    if (!check.ok || !check.player) {
      // O la transacción no es el pago de esta mesa, o el nodo todavía no la
      // ve. El cliente reintenta; nunca se le pide pagar otra vez.
      return NextResponse.json({ error: "join_not_found" }, { status: 400 });
    }
    if (check.payerMismatch) {
      return NextResponse.json(
        { error: "payer_mismatch", payer: check.player },
        { status: 409 }
      );
    }

    const profile = await ensureProfile(auth.identity);
    const seat = await nextFreeSeat(room.id);
    const written = await recordSeatPayment({
      roomId: room.id,
      profileId: profile.id,
      address: check.player,
      txHash,
      seat,
    });

    if (written.status === "conflict") {
      return NextResponse.json({ error: written.reason }, { status: 409 });
    }

    // `ok` y `duplicate` responden igual a propósito: reintentar el registro de
    // un pago que ya constaba no es un error, es la red haciendo su trabajo.
    return NextResponse.json({ seated: true, tableId });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
