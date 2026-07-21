export const ALIAS_MIN = 2;
export const ALIAS_MAX = 20;

// Letras (cualquier idioma), números, espacio, guion y guion bajo.
const ALIAS_REGEX = /^[\p{L}\p{N} _-]+$/u;

/** Recorta y colapsa espacios internos. */
export function normalizeAlias(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

export interface AliasCheck {
  ok: boolean;
  value?: string;
  error?: string;
}

/** Valida un alias. Se usa igual en el cliente (UX) y en el servidor (seguridad). */
export function validateAlias(raw: string): AliasCheck {
  const value = normalizeAlias(raw);
  if (value.length < ALIAS_MIN)
    return { ok: false, error: `El alias es muy corto (mínimo ${ALIAS_MIN}).` };
  if (value.length > ALIAS_MAX)
    return { ok: false, error: `El alias es muy largo (máximo ${ALIAS_MAX}).` };
  if (!ALIAS_REGEX.test(value))
    return { ok: false, error: "Solo letras, números, espacio, guion y guion bajo." };
  return { ok: true, value };
}
