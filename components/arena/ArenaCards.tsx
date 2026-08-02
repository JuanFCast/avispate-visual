"use client";

import {
  CARDS_MIN,
  MAX_DEALT_CARDS,
  cardPresets,
  clampCards,
  dealSummary,
  maxCardsPerPlayer,
} from "@/lib/arena-deck";
import { useT } from "@/lib/i18n/client";

/**
 * Cuánto dura la sala, en cartas por jugador.
 *
 * Reemplaza al par de botones "Rápida / Completa", que solo sabían decir el
 * mínimo y el máximo. Ahora la cifra es continua entre los dos, y los extremos
 * siguen ahí como atajos porque son las dos respuestas que la gente da sin
 * pensar: "una rapidita" y "la larga".
 *
 * Tres controles para el mismo número, a propósito:
 *   · el SLIDER, para barrer el rango de un gesto;
 *   · los BOTONES − / +, porque con 18 pasos en 300 px el dedo no acierta;
 *   · los PRESETS, que además enseñan su número y se re-etiquetan solos cuando
 *     cambia el tamaño de la sala (con cuatro jugadores "Larga" son 13, no 27).
 *
 * El resumen de abajo es lo que convierte la cifra en una decisión: nadie sabe
 * qué significan "18 cartas" hasta que ve que son 37 en juego y unos 4 minutos.
 */
export default function ArenaCards({
  cards,
  players,
  onChange,
  disabled,
}: {
  cards: number;
  players: number;
  onChange: (cards: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const max = maxCardsPerPlayer(players);
  const presets = cardPresets(players);
  const summary = dealSummary(cards, players);

  /** Nada llega al estado sin pasar por los límites de esta sala. */
  const set = (value: number) => onChange(clampCards(value, players));

  const presetList = [
    { id: "short", value: presets.short, label: t("cards.preset.short") },
    { id: "mid", value: presets.mid, label: t("cards.preset.mid") },
    { id: "long", value: presets.long, label: t("cards.preset.long") },
  ];

  return (
    <div className="field arena-cards">
      <div className="arena-cards-head">
        <label htmlFor="arena-cards-range">{t("cards.label")}</label>
        {/* El número vive junto a la etiqueta y no dentro del slider: es el
            dato, y tiene que poder leerse sin mirar dónde quedó el pulgar. */}
        <output htmlFor="arena-cards-range" className="arena-cards-value">
          {cards}
        </output>
      </div>

      <div className="arena-cards-row">
        <button
          type="button"
          className="arena-cards-step"
          onClick={() => set(cards - 1)}
          disabled={disabled || cards <= CARDS_MIN}
          aria-label={t("cards.less")}
        >
          −
        </button>
        <input
          id="arena-cards-range"
          className="arena-cards-range"
          type="range"
          min={CARDS_MIN}
          max={max}
          step={1}
          value={cards}
          onChange={(e) => set(Number(e.target.value))}
          disabled={disabled}
        />
        <button
          type="button"
          className="arena-cards-step"
          onClick={() => set(cards + 1)}
          disabled={disabled || cards >= max}
          aria-label={t("cards.more")}
        >
          +
        </button>
      </div>

      <div className="arena-cards-ends" aria-hidden="true">
        <span>{t("cards.min", { n: CARDS_MIN })}</span>
        <span>{t("cards.max", { n: max })}</span>
      </div>

      <div
        className="rounds-options arena-cards-presets"
        role="radiogroup"
        aria-label={t("cards.presets.aria")}
      >
        {presetList.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={cards === p.value}
            className={cards === p.value ? "selected" : ""}
            onClick={() => set(p.value)}
            disabled={disabled}
          >
            {p.label}
            <small className="deck-price">{p.value}</small>
          </button>
        ))}
      </div>

      {/* Se recalcula con cada toque y se anuncia entero: leer "36… 1… 37…"
          cifra a cifra no le dice nada a nadie. */}
      <dl className="arena-cards-summary" aria-live="polite">
        <div>
          <dt>{t("cards.summary.dealt")}</dt>
          <dd>{summary.dealt}</dd>
        </div>
        <div>
          <dt>{t("cards.summary.base")}</dt>
          <dd>{summary.base}</dd>
        </div>
        <div className="arena-cards-total">
          <dt>{t("cards.summary.in_play", { max: MAX_DEALT_CARDS })}</dt>
          <dd>{summary.inPlay}</dd>
        </div>
        <div>
          <dt>{t("cards.summary.time")}</dt>
          <dd>{t("cards.summary.minutes", { n: summary.minutes })}</dd>
        </div>
      </dl>
    </div>
  );
}
