export const ALIAS_MIN = 2;
export const ALIAS_MAX = 20;

// Letras (cualquier idioma), números, espacio, guion y guion bajo.
const ALIAS_REGEX = /^[\p{L}\p{N} _-]+$/u;

/** Recorta y colapsa espacios internos. */
export function normalizeAlias(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Por qué falló la validación. Es un CÓDIGO y no una frase porque esta función
 * corre también en el servidor, que no sabe (ni debe saber) en qué idioma está
 * mirando el jugador: la pantalla lo traduce con `lib/i18n`.
 */
export type AliasError = "alias_too_short" | "alias_too_long" | "alias_charset";

export interface AliasCheck {
  ok: boolean;
  value?: string;
  error?: AliasError;
}

/** Valida un alias. Se usa igual en el cliente (UX) y en el servidor (seguridad). */
export function validateAlias(raw: string): AliasCheck {
  const value = normalizeAlias(raw);
  if (value.length < ALIAS_MIN) return { ok: false, error: "alias_too_short" };
  if (value.length > ALIAS_MAX) return { ok: false, error: "alias_too_long" };
  if (!ALIAS_REGEX.test(value)) return { ok: false, error: "alias_charset" };
  return { ok: true, value };
}
