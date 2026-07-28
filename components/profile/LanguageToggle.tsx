"use client";

import { useI18n } from "@/lib/i18n/client";
import { LANGS, type Lang } from "@/lib/i18n";

/**
 * Cambio manual de idioma. El juego ya arranca en el idioma del dispositivo;
 * esto es para quien tiene el teléfono en un idioma y prefiere jugar en otro.
 * La elección queda en una cookie, así que el servidor la respeta desde la
 * siguiente carga y no vuelve a mandar el idioma del dispositivo.
 */
export default function LanguageToggle() {
  const { lang, t, setLang } = useI18n();

  return (
    <div
      className="rounds-options lang-toggle"
      role="radiogroup"
      aria-label={t("lang.aria")}
    >
      {LANGS.map((option: Lang) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === lang}
          className={option === lang ? "selected" : ""}
          onClick={() => setLang(option)}
        >
          {t(option === "es" ? "lang.es" : "lang.en")}
        </button>
      ))}
    </div>
  );
}
