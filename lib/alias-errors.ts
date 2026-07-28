import { ALIAS_MAX, ALIAS_MIN } from "./alias";
import type { MessageKey, Translate } from "./i18n";

/**
 * Traduce el motivo por el que un alias no sirve. El código puede venir de
 * `validateAlias` (cliente) o del servidor (`alias_taken`, `server_error`…), así
 * que lo desconocido cae en un mensaje genérico en vez de mostrar el código.
 */
export function aliasErrorText(
  t: Translate,
  code: string | null | undefined,
  fallback: MessageKey = "alias.error.invalid"
): string {
  switch (code) {
    case "alias_too_short":
      return t("alias.error.too_short", { min: ALIAS_MIN });
    case "alias_too_long":
      return t("alias.error.too_long", { max: ALIAS_MAX });
    case "alias_charset":
      return t("alias.error.charset");
    case "alias_taken":
      return t("alias.error.taken_pick");
    default:
      return t(fallback);
  }
}
