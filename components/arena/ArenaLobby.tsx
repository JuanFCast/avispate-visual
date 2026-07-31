"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ARENA_ENTRY_UNITS,
  ARENA_PLAYER_OPTIONS,
  DEFAULT_ENTRY_UNITS,
  DEFAULT_PLAYERS,
  arenaPrize,
  fmtEntry,
  fmtUsdt,
} from "@/lib/arena";
import { useT } from "@/lib/i18n/client";
import ArenaHowTo from "./ArenaHowTo";
import ArenaPlayers from "./ArenaPlayers";

/** Los dos caminos para entrar a una mesa. */
const MODES = [
  {
    id: "quick",
    href: "/arena/rapida",
    emoji: "⚡",
    titleKey: "arena.mode.quick.title",
    textKey: "arena.mode.quick.text",
    ctaKey: "arena.mode.quick.cta",
  },
  {
    id: "private",
    href: "/arena/privada",
    emoji: "🔒",
    titleKey: "arena.mode.private.title",
    textKey: "arena.mode.private.text",
    ctaKey: "arena.mode.private.cta",
  },
] as const;

type ModeId = (typeof MODES)[number]["id"];

/**
 * Lobby de la Arena: cómo entrar, con cuánto y contra cuántos.
 *
 * Una sola elección se arrastra hasta el final —modo, entrada y jugadores— y
 * el cálculo del premio se rehace con cada toque, así que el jugador ve lo que
 * se lleva ANTES de decidir. El botón todavía no arma una mesa: lleva a la
 * pantalla del modo, que es donde vivirán el emparejamiento y el código.
 */
export default function ArenaLobby() {
  const t = useT();
  const [mode, setMode] = useState<ModeId>("quick");
  const [entryUnits, setEntryUnits] = useState<bigint>(DEFAULT_ENTRY_UNITS);
  const [players, setPlayers] = useState<number>(DEFAULT_PLAYERS);
  const [howToOpen, setHowToOpen] = useState(false);

  const prize = arenaPrize(entryUnits, players);
  const selected = MODES.find((m) => m.id === mode) ?? MODES[0];
  // La configuración viaja en el enlace: la pantalla del modo la repite, así
  // que volver atrás y entrar de nuevo no pierde lo ya elegido.
  const href = `${selected.href}?entry=${entryUnits}&players=${players}`;

  return (
    <>
      <header className="arena-lobby-head">
        <span className="arena-tag">{t("arena.tag")}</span>
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

      <section
        className="arena-modes"
        role="radiogroup"
        aria-label={t("arena.mode.aria")}
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.id === mode}
            className={`arena-mode${m.id === mode ? " selected" : ""}`}
            onClick={() => setMode(m.id)}
          >
            <span className="arena-mode-emoji" aria-hidden="true">
              {m.emoji}
            </span>
            <span className="arena-mode-body">
              <span className="arena-mode-title">{t(m.titleKey)}</span>
              <small className="arena-mode-text">{t(m.textKey)}</small>
            </span>
            <span className="arena-mode-check" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </section>

      <section className="arena-card arena-setup" aria-label={t("arena.setup.aria")}>
        <div className="field">
          <label id="arena-entry-label">{t("arena.entry.label")}</label>
          <div
            className="rounds-options"
            role="radiogroup"
            aria-labelledby="arena-entry-label"
          >
            {ARENA_ENTRY_UNITS.map((units) => (
              <button
                key={units.toString()}
                type="button"
                role="radio"
                aria-checked={units === entryUnits}
                className={units === entryUnits ? "selected" : ""}
                onClick={() => setEntryUnits(units)}
              >
                {fmtEntry(units)}
                <small className="deck-price">USDT</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label id="arena-players-label">{t("arena.players.label")}</label>
          <div
            className="rounds-options"
            role="radiogroup"
            aria-labelledby="arena-players-label"
          >
            {ARENA_PLAYER_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === players}
                className={n === players ? "selected" : ""}
                onClick={() => setPlayers(n)}
              >
                {n}
                <small className="deck-price">{t("arena.players.unit")}</small>
              </button>
            ))}
          </div>
        </div>

        {/* El cálculo se rehace con cada toque: se anuncia entero, no cifra a
            cifra, para que el lector de pantalla lea el reparto de una vez. */}
        <div className="arena-prize" aria-live="polite">
          <div className="arena-prize-row">
            <span>{t("arena.prize.pot")}</span>
            <strong>{fmtUsdt(prize.potUnits)} USDT</strong>
          </div>
          <div className="arena-prize-row arena-prize-fee">
            <span>{t("arena.prize.fee")}</span>
            <strong>−{fmtUsdt(prize.commissionUnits)} USDT</strong>
          </div>
          <div className="arena-prize-row arena-prize-win">
            <span>{t("arena.prize.winner")}</span>
            <strong>{fmtUsdt(prize.winnerUnits)} USDT</strong>
          </div>
        </div>

        <p className="arena-prize-note">{t("arena.prize.note")}</p>

        <Link className="arena-cta" href={href}>
          {t(selected.ctaKey)}
        </Link>
      </section>

      {howToOpen && <ArenaHowTo onClose={() => setHowToOpen(false)} />}
    </>
  );
}
