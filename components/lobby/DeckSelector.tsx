"use client";

import { DECK_OPTIONS } from "@/lib/game";

interface Props {
  value: number;
  onChange: (deck: number) => void;
  /** Qué mazos aún tienen la jugada gratis de hoy. */
  freeByDeck: Record<number, boolean>;
}

/**
 * Selector único de mazo. Es controlado: GameShell posee el deckSize y todo el
 * lobby (premio, elegibilidad, top 3) cambia junto con esta única elección.
 */
export default function DeckSelector({ value, onChange, freeByDeck }: Props) {
  return (
    <div className="field">
      <label id="deck-selector-label">Cartas del mazo</label>
      <div
        className="rounds-options"
        role="radiogroup"
        aria-labelledby="deck-selector-label"
      >
        {DECK_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            className={option === value ? "selected" : ""}
            onClick={() => onChange(option)}
          >
            {option}
            <small className="deck-price">
              {freeByDeck[option] ? "gratis" : "0.10 USDT"}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}
