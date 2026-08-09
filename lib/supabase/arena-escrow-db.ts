import { getSupabaseAdmin } from "./server";
import { classifySeatWrite } from "../arena-idempotency";
import { firstFreeSeat } from "../arena-seating";

/**
 * El registro de que el dinero de la Arena se movió: pagos por silla,
 * liquidaciones y devoluciones.
 *
 * Todo lo de aquí es idempotente, y lo es apoyándose en los índices únicos de
 * la migración, no en un `if` previo. La diferencia importa: entre "mirar si ya
 * existe" y "escribir" cabe otra petición, y con dinero eso significa dos
 * sillas por un pago o dos liquidaciones del mismo pozo. Se escribe, y si la
 * base dice que ya estaba (23505), eso ES el éxito.
 */

/** 23505 = índice único violado. Aquí siempre significa "ya estaba". */
const UNIQUE_VIOLATION = "23505";

export type EscrowWrite =
  /** Escrito ahora. */
  | { status: "ok" }
  /** Ya estaba: un reintento, no un error. */
  | { status: "duplicate" }
  /** Ese hueco ya lo ocupa OTRA cosa. Nunca se pisa: se avisa. */
  | { status: "conflict"; reason: string };

/**
 * Sienta a quien pagó, dejando constancia de con qué transacción.
 *
 * La silla se crea aquí y solo aquí cuando la mesa cobra: ya no la crea el
 * hecho de entrar a la sala. Reintentar con el mismo hash no crea una segunda
 * —lo impide `arena_room_players_join_tx_key`—, y una segunda transacción de la
 * misma dirección en la misma sala tampoco, por `arena_room_players_wallet_key`.
 */
export async function recordSeatPayment(params: {
  roomId: string;
  profileId: string;
  /** Dirección que pagó, según la CADENA. Nunca la que dijo el navegador. */
  address: string;
  txHash: string;
  seat: number;
}): Promise<EscrowWrite> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("arena_room_players").insert({
    room_id: params.roomId,
    profile_id: params.profileId,
    seat: params.seat,
    is_host: params.seat === 0,
    is_ready: false,
    wallet_address: params.address.toLowerCase(),
    join_tx_hash: params.txHash.toLowerCase(),
    paid_at: new Date().toISOString(),
  });

  if (!error) return { status: "ok" };
  if (error.code !== UNIQUE_VIOLATION) throw error;

  // Chocó contra un índice único. Cuál importa: si es el del hash, es el mismo
  // pago reintentado y está bien. Si es el de la silla o el de la dirección, es
  // otra cosa ocupando el sitio y hay que decirlo en vez de fingir éxito.
  const { data } = await db
    .from("arena_room_players")
    .select("join_tx_hash, wallet_address")
    .eq("room_id", params.roomId)
    .eq("wallet_address", params.address.toLowerCase())
    .maybeSingle();

  return classifySeatWrite(data, params.txHash);
}

/**
 * El perfil dueño de la silla que pagó esa dirección, o `null`.
 *
 * Es la traducción de "la wallet que probó la ficha" a "con qué fila actúa",
 * y el único puente que `arena-actor.ts` necesita: la autoridad viene de la
 * dirección, el `profile_id` solo dice a qué fila aplicarla.
 */
export async function seatProfileOf(
  roomId: string,
  address: string
): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_room_players")
    .select("profile_id")
    .eq("room_id", roomId)
    .eq("wallet_address", address.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data?.profile_id as string | undefined) ?? null;
}

/**
 * Sienta a quien pagó, buscándole asiento y reintentando si se lo quitan.
 *
 * `nextFreeSeat` mira y `recordSeatPayment` escribe, y entre las dos cabe otra
 * petición: dos jugadores que registran su pago a la vez calculan el mismo
 * asiento y el segundo choca contra `(room_id, seat)`. Sin este bucle ese
 * choque sale por la ruta como un 409, que `registerSeat` trata como final —
 * y el final sería una entrada pagada que nunca se registra por haber llegado
 * en el mismo segundo que otra. Se recalcula y se vuelve a intentar, que es
 * justo lo que `classifySeatWrite` pide al devolver `seat_taken`.
 *
 * Los otros dos desenlaces no se reintentan porque no cambiarían: el mismo
 * pago ya registrado es éxito, y una dirección ya sentada con OTRO pago es un
 * conflicto de verdad que hay que contar.
 */
export async function seatPaidPlayer(params: {
  roomId: string;
  profileId: string;
  address: string;
  txHash: string;
  maxPlayers: number;
}): Promise<EscrowWrite> {
  let last: EscrowWrite = { status: "conflict", reason: "seat_taken" };

  for (let attempt = 0; attempt < 6; attempt++) {
    const seat = await nextFreeSeat(params.roomId, params.maxPlayers);
    // Sin asiento libre no se fuerza uno fuera de rango: eso reventaba contra
    // el `check` de la base y salía como 500. Se dice que la mesa está llena,
    // que es lo que pasa, y queda a la vista en vez de parecer una avería.
    if (seat === null) return { status: "conflict", reason: "room_full" };

    last = await recordSeatPayment({ ...params, seat });
    if (last.status !== "conflict" || last.reason !== "seat_taken") return last;
  }

  return last;
}

/**
 * Deja constancia de la liquidación. UNA por mesa: el índice único sobre
 * `table_id` es lo que impide que un cron solapado pague dos veces el pozo.
 *
 * Se escribe ANTES de mandar la transacción, sin hash, y se confirma después.
 * Ese orden es a propósito: si se escribiera al confirmar, una caída entre la
 * transacción y el registro dejaría un pozo pagado del que no queda rastro, y
 * el siguiente intento lo pagaría otra vez.
 */
export async function claimSettlement(params: {
  roomId: string;
  tableId: string;
  winnerProfileId: string | null;
  winnerAddress: string;
  reason: "cleared" | "abandoned";
  prizeUnits: bigint;
  commissionUnits: bigint;
}): Promise<EscrowWrite> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("arena_settlements").insert({
    room_id: params.roomId,
    table_id: params.tableId.toLowerCase(),
    winner_profile_id: params.winnerProfileId,
    winner_address: params.winnerAddress.toLowerCase(),
    reason: params.reason,
    prize_units: params.prizeUnits.toString(),
    commission_units: params.commissionUnits.toString(),
  });

  if (!error) return { status: "ok" };
  if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
  throw error;
}

/** Anota el hash de la liquidación una vez la cadena la confirmó. */
export async function confirmSettlement(
  tableId: string,
  txHash: string
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("arena_settlements")
    .update({
      tx_hash: txHash.toLowerCase(),
      confirmed_at: new Date().toISOString(),
    })
    .eq("table_id", tableId.toLowerCase())
    .is("tx_hash", null);
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}

/**
 * Deja constancia de una devolución. Una por dirección y mesa: cobrar dos veces
 * la misma entrada sería sacar dinero de las entradas de los demás.
 */
export async function recordRefund(params: {
  tableId: string;
  address: string;
  amountUnits: bigint;
  txHash?: string;
}): Promise<EscrowWrite> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("arena_refunds").insert({
    table_id: params.tableId.toLowerCase(),
    address: params.address.toLowerCase(),
    amount_units: params.amountUnits.toString(),
    tx_hash: params.txHash?.toLowerCase() ?? null,
  });

  if (!error) return { status: "ok" };
  if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
  throw error;
}

/** La liquidación de una mesa, si ya se reclamó. */
export async function settlementOf(tableId: string): Promise<{
  winner_address: string;
  tx_hash: string | null;
} | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_settlements")
    .select("winner_address, tx_hash")
    .eq("table_id", tableId.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * El primer asiento libre de una sala, o `null` si no queda.
 *
 * Se leen TODOS los asientos y se busca el primer hueco, en vez de pedir el
 * mayor y sumarle uno. Con `max + 1`, unos asientos {0, 1, 2, 3} daban 4 —que
 * la base rechaza por `check (seat between 0 and 3)`— y ese rechazo no es un
 * conflicto reintentable sino una excepción: en `/paid` salía como un 500
 * permanente delante de alguien que ya había pagado su entrada. La regla vive
 * en `firstFreeSeat` para poder probarla con huecos sin tocar la base.
 *
 * La carrera la sigue arbitrando el índice único `(room_id, seat)`: esto mira,
 * y entre mirar y escribir cabe otro. Por eso quien llama reintenta.
 */
export async function nextFreeSeat(
  roomId: string,
  maxPlayers: number
): Promise<number | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("arena_room_players")
    .select("seat")
    .eq("room_id", roomId);
  if (error) throw error;
  return firstFreeSeat(
    (data ?? []).map((row) => Number(row.seat)),
    maxPlayers
  );
}
