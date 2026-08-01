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
  invalid_code: "room.error.invalid_code",
  room_not_found: "room.error.not_found",
  room_closed: "room.error.closed",
  room_full: "room.error.full",
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
