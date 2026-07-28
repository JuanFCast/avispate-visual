/**
 * Idioma de la interfaz: inglés y español.
 *
 * El inglés manda por defecto —la base de usuarios de MiniPay está sobre todo
 * en inglés— y el español entra solo cuando el dispositivo lo pide. La
 * detección ocurre en el servidor con la cabecera `Accept-Language`, así que la
 * primera pintura ya llega en el idioma correcto y `<html lang>` no miente. Si
 * el jugador elige idioma a mano, la cookie manda sobre el dispositivo.
 */

import { en, es, type MessageKey } from "./dictionary";

export type { MessageKey };
export type Lang = "en" | "es";

export const LANGS: readonly Lang[] = ["en", "es"];
export const DEFAULT_LANG: Lang = "en";

/** Cookie con la elección manual del jugador. La lee el servidor y el cliente. */
export const LANG_COOKIE = "avispate_lang";
/** Un año: la elección de idioma no debería caducar en una sesión. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, es };

/** `"es-CO"`, `"ES"`, `"es"` → `"es"`. Cualquier otra cosa → `null`. */
export function normalizeLang(value: string | null | undefined): Lang | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().split("-")[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : null;
}

/**
 * Idioma según `Accept-Language`. Gana el de MAYOR prioridad que conozcamos:
 * un `es-CO,en;q=0.8` es español, y un `fr,en;q=0.9,es;q=0.5` es inglés. Si no
 * aparece ninguno de los dos, inglés.
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return { lang: normalizeLang(tag), q: q === undefined ? 1 : Number(q) };
    })
    .filter((entry): entry is { lang: Lang; q: number } => entry.lang !== null)
    .filter((entry) => Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked[0]?.lang ?? DEFAULT_LANG;
}

/** Idioma del navegador. Solo tiene sentido en el cliente. */
export function langFromNavigator(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const tag of tags) {
    const lang = normalizeLang(tag);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}

/** Lee la cookie de idioma de un `document.cookie` (o de una cabecera Cookie). */
export function langFromCookieHeader(cookie: string | null | undefined): Lang | null {
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|; *)${LANG_COOKIE}=([^;]*)`));
  return match ? normalizeLang(decodeURIComponent(match[1])) : null;
}

/** Locale completo para `Intl` / `toLocaleString`. */
export function localeFor(lang: Lang): string {
  return lang === "es" ? "es-CO" : "en-US";
}

export type Vars = Record<string, string | number>;

/** Reemplaza `{nombre}` por el valor correspondiente. */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * Traduce una clave. Si por lo que sea faltara en el idioma pedido cae al
 * inglés, que es la definición completa del diccionario.
 */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template = DICTS[lang]?.[key] ?? en[key];
  return interpolate(template, vars);
}

export type Translate = (key: MessageKey, vars?: Vars) => string;

/** Traductor ligado a un idioma, para pasarlo a funciones que no son React. */
export function translatorFor(lang: Lang): Translate {
  return (key, vars) => translate(lang, key, vars);
}
