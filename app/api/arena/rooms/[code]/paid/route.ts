import { NextResponse } from "next/server";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { getRoomByCode } from "@/lib/supabase/arena-rooms";
import { ensureProfileByWallet } from "@/lib/supabase/profiles";
import { escrowConfigured, verifyJoinTx } from "@/lib/arena-escrow";
import { seatPaidPlayer } from "@/lib/supabase/arena-escrow-db";
import { allow, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TX_RE = /^0x[0-9a-f]{64}$/i;
const ADDR_RE = /^0x[0-9a-f]{40}$/i;

/**
 * Generoso a propósito: el camino normal reintenta con espera creciente hasta
 * seis veces, y encima puede haber varios jugadores tras la misma IP —una casa,
 * una oficina, una red móvil—. Esto no está para molestar a quien reintenta,
 * sino para que un bucle no se vuelva un grifo de lecturas al RPC.
 */
const LIMIT = { limit: 30, windowMs: 60_000 };

interface Ctx {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/arena/rooms/[code]/paid — la silla ya está pagada; siéntame.
 *
 * El orden completo de una mesa con entrada:
 *
 *   crear sala → ver el código → pagar `join` on-chain → ESTO → canjear la
 *   silla en `/api/arena/seat` → jugar
 *
 * Y el anfitrión no se salta ninguno: crear la mesa no lo sienta. No puede,
 * porque hasta que la sala no existe no hay código, y sin código no hay mesa
 * que pagar. Nadie se sienta sin pagar, tampoco quien montó la partida.
 *
 * ── Por qué esto NO pide sesión (decisión del 2026-08-08) ──────────────────
 *
 * Porque la sesión no probaba nada aquí y sí podía estorbar.
 *
 * No probaba nada: lo que autoriza la silla es el evento `Joined` del contrato,
 * y de él sale también la dirección. La sesión nunca se comparaba con el
 * pagador —solo se exigía que existiera alguna—, así que cualquiera con una
 * cuenta valía. Lo único que decidía era el `profile_id` de la silla, y eso era
 * peor que inútil: un tercero que copiara el txHash de la cadena podía llegar
 * antes y dejar el pago de otra wallet apuntando a SU perfil. El pagador se
 * quedaba con la silla registrada y sin poder jugarla.
 *
 * Y estorbaba: dentro de MiniPay la primera sesión del jugador nace de esta
 * misma transacción, y `/api/session/wallet` consume el hash de una sola vez.
 * Quien mirara la cadena podía canjearlo primero y dejar al pagador sin sesión
 * posible con ese hash — o sea, con un 401 permanente delante de su silla ya
 * pagada. Sin sesión de por medio, ese ataque se queda sin efecto.
 *
 * Así que el perfil se deriva de la wallet que pagó, leída del evento. La
 * cadena dice quién es; nosotros no lo elegimos ni se lo preguntamos a nadie.
 *
 * Jugar sigue exigiendo la ficha de silla: registrar es contar un hecho que ya
 * ocurrió, actuar es otra cosa y la gobierna `arena-actor.ts`.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!escrowConfigured()) {
    return NextResponse.json({ error: "escrow_disabled" }, { status: 503 });
  }

  // Los cheques baratos van antes de tocar la cadena: forma del código, forma
  // del hash y existencia de la sala se resuelven sin salir de aquí, y así una
  // petición basura no cuesta una lectura al RPC.
  const { code: raw } = await ctx.params;
  const code = normalizeRoomCode(raw);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const txHash = String(body?.txHash ?? "");
  if (!TX_RE.test(txHash)) {
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  }
  // La dirección es opcional y solo informativa: quien pagó lo dice la cadena.
  // Se acepta para poder avisar cuando el navegador se equivoca de wallet, pero
  // no participa en ninguna decisión.
  const claimed = String(body?.address ?? "");
  if (claimed && !ADDR_RE.test(claimed)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  if (!allow(clientKey(req), LIMIT)) {
    return NextResponse.json({ error: "slow_down" }, { status: 429 });
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
    const check = await verifyJoinTx(txHash, tableId, claimed || undefined);
    if (!check.ok || !check.player) {
      // O la transacción no es el pago de esta mesa, o el nodo todavía no la
      // ve. El cliente reintenta; nunca se le pide pagar otra vez.
      return NextResponse.json({ error: "join_not_found" }, { status: 400 });
    }

    /**
     * El pagador se sienta AUNQUE el navegador se haya equivocado de wallet.
     *
     * Antes esto era un 409 que paraba el registro en seco. Era el reflejo de
     * cuando la dirección del cuerpo importaba; ahora no importa, y negarse a
     * registrar un pago que la cadena confirma sería crear a mano el final que
     * este endpoint existe para evitar. Se sienta a quien pagó y se le devuelve
     * la dirección real, que es lo que el cliente necesita para pedir su ficha
     * con la wallet correcta.
     */
    const profile = await ensureProfileByWallet(check.player);
    const written = await seatPaidPlayer({
      roomId: room.id,
      profileId: profile.id,
      address: check.player,
      txHash,
    });

    if (written.status === "conflict") {
      return NextResponse.json({ error: written.reason }, { status: 409 });
    }

    // `ok` y `duplicate` responden igual a propósito: reintentar el registro de
    // un pago que ya constaba no es un error, es la red haciendo su trabajo.
    return NextResponse.json({ seated: true, tableId, payer: check.player });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
