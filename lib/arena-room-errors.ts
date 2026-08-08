import type { MessageKey, Translate } from "./i18n";

/**
 * Traduce el motivo por el que una sala no se pudo abrir, no dejó entrar o dejó
 * de existir. El código viaja desde el servidor sin idioma —él no sabe en cuál
 * está mirando el jugador— y se convierte en frase aquí.
 *
 * Lo desconocido cae en el mensaje genérico: mostrar `not_in_room` en pantalla
 * no ayuda a nadie a decidir qué hacer.
 */
const TEXTS: Record<string, MessageKey> = {
  /**
   * Los rechazos del guardia de sillas. Merecen texto propio: en una mesa con
   * entrada son los MÁS probables, y con el mensaje genérico la pantalla parecía
   * congelada — tocabas y no pasaba nada, sin decir por qué.
   */
  seat_token_required: "room.error.seat_token",
  seat_token_wrong_table: "room.error.seat_token",
  seat_not_paid: "room.error.seat_not_paid",
  invalid_code: "room.error.invalid_code",
  room_not_found: "room.error.not_found",
  room_closed: "room.error.closed",
  room_full: "room.error.full",
  /**
   * Los rechazos de repartir. El de la mesa incompleta lleva además la frase
   * que hace falta en ese momento exacto: que la entrada sigue guardada. Quien
   * acaba de poner un dólar y ve un error rojo asume lo peor, y en este caso lo
   * peor no pasó — no se puede repartir precisamente para que no pase.
   */
  room_not_full: "room.error.not_full",
  players_not_ready: "room.error.players_not_ready",
  seats_not_paid: "room.error.seats_not_paid",
  not_in_room: "room.error.not_in_room",
  not_host: "room.error.not_host",
  unauthorized: "room.error.unauthorized",
  invalid_setup: "room.error.invalid_setup",
  table_too_big: "room.error.table_too_big",
};

export function roomErrorText(
  t: Translate,
  code: string | null | undefined,
  fallback: MessageKey = "room.error.generic"
): string {
  const key = code ? TEXTS[code] : undefined;
  return t(key ?? fallback);
}
