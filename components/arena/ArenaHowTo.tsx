"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/client";

/** Los tres pasos, en el orden en que le pasan al jugador. */
const STEPS = [1, 2, 3] as const;

/**
 * "Cómo se juega" de la Arena: tres pasos y a jugar. No es el tutorial del
 * reto diario —ese enseña a encontrar el símbolo con cartas de verdad— sino
 * lo que cambia al competir: varias personas a la vez y gana quien se queda
 * primero sin cartas.
 *
 * Misma caja que el modal de acceso del lobby, con el mismo teclado: Escape
 * cierra, el tabulador no se escapa del diálogo y el fondo no hace scroll.
 */
export default function ArenaHowTo({ onClose }: { onClose: () => void }) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  // Foco dentro del diálogo al abrir; al cerrar vuelve al botón que lo abrió.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.querySelector<HTMLElement>("[data-arena-howto]")?.focus();
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")
      ).filter((el) => el.tabIndex !== -1);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="lobby-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="lobby-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-howto-title"
      >
        <button
          type="button"
          className="lobby-modal-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          ✕
        </button>

        <h2 id="arena-howto-title" className="lobby-modal-title">
          {t("arena.howto.title")}
        </h2>

        <ul className="fund-options">
          {STEPS.map((n) => (
            <li key={n} className="fund-option">
              <p className="fund-option-title">
                <span className="fund-option-num" aria-hidden="true">
                  {n}
                </span>
                {t(`arena.howto.s${n}.title` as const)}
              </p>
              <p className="fund-option-hint">
                {t(`arena.howto.s${n}.text` as const)}
              </p>
            </li>
          ))}
        </ul>

        <p className="lobby-modal-text">{t("arena.howto.note")}</p>

        <button type="button" className="lobby-modal-later" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
