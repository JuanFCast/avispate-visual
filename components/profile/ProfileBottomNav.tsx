"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";

const ITEMS: { key: string; labelKey: MessageKey; emoji: string; href: string }[] =
  [
    { key: "inicio", labelKey: "nav.play", emoji: "🐝", href: "/" },
    { key: "historial", labelKey: "nav.history", emoji: "🏆", href: "/historial" },
    { key: "perfil", labelKey: "nav.profile", emoji: "👤", href: "/perfil" },
  ];

/**
 * Barra inferior fija: Jugar · Historial · Perfil. Tres destinos y no cuatro:
 * el ranking del día ya se alcanza desde "Ver ranking completo" en el lobby y
 * desde /historial, así que no necesita botón propio aquí. Respeta el
 * safe-area. Una `active` que no coincida con ninguno (p. ej. en /ranking)
 * deja la barra sin resaltar, que es lo correcto.
 */
export default function ProfileBottomNav({ active }: { active: string }) {
  const t = useT();

  return (
    <nav className="bottom-nav" aria-label={t("nav.aria")}>
      <div className="bottom-nav-inner">
        {ITEMS.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={`bottom-nav-item${it.key === active ? " active" : ""}`}
            aria-current={it.key === active ? "page" : undefined}
          >
            <span className="bottom-nav-emoji" aria-hidden="true">
              {it.emoji}
            </span>
            <span className="bottom-nav-label">{t(it.labelKey)}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
