"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANG,
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  langFromCookieHeader,
  langFromNavigator,
  localeFor,
  translate,
  type Lang,
  type Translate,
} from "./index";

interface I18nValue {
  lang: Lang;
  /** `"es-CO"` / `"en-US"`, para `Intl` y `toLocaleString`. */
  locale: string;
  t: Translate;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function writeCookie(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Idioma en el cliente.
 *
 * `initialLang` viene del servidor (cookie o `Accept-Language`), así que el
 * primer render del cliente coincide con el HTML y no hay parpadeo ni error de
 * hidratación. Después de montar se comprueba `navigator.language` por si el
 * dispositivo dice algo distinto a la cabecera —pasa en algunas webviews— y
 * solo entonces se corrige.
 */
export function I18nProvider({
  initialLang,
  children,
}: {
  initialLang: Lang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeCookie(next);
    document.documentElement.lang = next;
  }, []);

  // Sin elección guardada, el navegador tiene la última palabra sobre la
  // cabecera. Con cookie no se toca nada: el jugador ya decidió.
  useEffect(() => {
    if (langFromCookieHeader(document.cookie)) return;
    const fromDevice = langFromNavigator();
    if (fromDevice !== initialLang) setLangState(fromDevice);
    document.documentElement.lang = fromDevice;
  }, [initialLang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      locale: localeFor(lang),
      t: (key, vars) => translate(lang, key, vars),
      setLang,
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    // Fuera del provider (tests, un componente montado suelto) el inglés es
    // una respuesta válida, no un motivo para tumbar la pantalla.
    return {
      lang: DEFAULT_LANG,
      locale: localeFor(DEFAULT_LANG),
      t: (key, vars) => translate(DEFAULT_LANG, key, vars),
      setLang: () => {},
    };
  }
  return value;
}

/** Atajo para el caso común: solo traducir. */
export function useT(): Translate {
  return useI18n().t;
}
