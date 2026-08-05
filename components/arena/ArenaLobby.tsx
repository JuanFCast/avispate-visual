"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import ArenaHowTo from "./ArenaHowTo";
import ArenaPlayers from "./ArenaPlayers";
import ArenaResume from "./ArenaResume";

/**
 * Los caminos para entrar a una sala. Cada uno es un enlace, no una opción:
 * tocarlo ya te lleva, sin un botón abajo que confirme lo que acabas de tocar.
 */
const WAYS = [
  {
    id: "create",
    href: "/arena/crear",
    emoji: "🔒",
    titleKey: "arena.way.create.title",
    textKey: "arena.way.create.text",
  },
  {
    id: "join",
    href: "/arena/codigo",
    emoji: "🔑",
    titleKey: "arena.way.join.title",
    textKey: "arena.way.join.text",
  },
] as const satisfies readonly {
  id: string;
  href: string;
  emoji: string;
  titleKey: MessageKey;
  textKey: MessageKey;
}[];

/**
 * /arena — una sola pregunta: ¿cómo quieres jugar?
 *
 * Antes esta pantalla preguntaba tres cosas —cómo entrar, con cuánto y contra
 * cuántos— y la siguiente volvía a preguntar las mismas. Peor: si terminabas
 * entrando con el código de un amigo, todo lo que habías configurado se tiraba,
 * porque en una sala manda quien la arma.
 *
 * La regla que ordena el recorrido es esa misma: SOLO CONFIGURA QUIEN ARMA LA
 * SALA. Así que aquí no hay entrada, ni jugadores, ni cartas, ni pozo — nada de
 * eso sirve todavía, porque no sabemos si vas a proponer una sala o a aceptar
 * la de otro. Se pregunta cuando la respuesta le sirve a alguien.
 */
export default function ArenaLobby() {
  const t = useT();
  const [howToOpen, setHowToOpen] = useState(false);

  return (
    <>
      <header className="arena-lobby-head">
        <h1 className="page-title">{t("arena.title")}</h1>
        <p className="page-lead">{t("arena.lead")}</p>
        <button
          type="button"
          className="lobby-howto"
          data-arena-howto
          onClick={() => setHowToOpen(true)}
        >
          {t("arena.howto.open")}
        </button>
      </header>

      <div className="arena-art arena-lobby-art">
        <ArenaPlayers />
      </div>

      <ArenaResume />

      <nav className="arena-modes" aria-label={t("arena.choose.aria")}>
        {WAYS.map((way) => (
          <Link key={way.id} className="arena-mode arena-mode-link" href={way.href}>
            <span className="arena-mode-emoji" aria-hidden="true">
              {way.emoji}
            </span>
            <span className="arena-mode-body">
              <span className="arena-mode-title">{t(way.titleKey)}</span>
              <small className="arena-mode-text">{t(way.textKey)}</small>
            </span>
            <span className="arena-mode-go" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </nav>

      {howToOpen && <ArenaHowTo onClose={() => setHowToOpen(false)} />}
    </>
  );
}
