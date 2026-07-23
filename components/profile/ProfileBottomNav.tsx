"use client";

import Link from "next/link";

const ITEMS = [
  { key: "inicio", label: "Jugar", emoji: "🐝", href: "/visual-rush" },
  { key: "ranking", label: "Ranking", emoji: "🏆", href: "/ranking" },
  { key: "perfil", label: "Perfil", emoji: "👤", href: "/perfil" },
];

/** Barra inferior fija: Jugar · Ranking · Perfil. Respeta el safe-area. */
export default function ProfileBottomNav({ active }: { active: string }) {
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
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
            <span className="bottom-nav-label">{it.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
