/**
 * Un color estable por asiento, no por jugador.
 *
 * Estable por ASIENTO y no por perfil: el asiento (`seat`, 0-3) lo asigna el
 * servidor al repartir y no cambia en toda la partida, así que el mismo
 * jugador conserva el mismo color del principio al fin sin guardar nada en
 * el cliente ni derivar un hash de su dirección.
 *
 * Es decoración, nunca el único distintivo: en el tablero acompaña al
 * nombre (un punto de color, no reemplaza el texto).
 */
const SEAT_COLORS = ["#FFC20E", "#00C7D6", "#2FBF71", "#8B5CF6"] as const;

export function seatColor(seat: number | null | undefined): string {
  if (seat === null || seat === undefined || !Number.isFinite(seat)) {
    return SEAT_COLORS[0];
  }
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}
