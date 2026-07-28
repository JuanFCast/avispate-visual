"use client";

import { DECK_OPTIONS } from "@/lib/game";
import { useT } from "@/lib/i18n/client";

interface Props {
  value: number;
  onChange: (deck: number) => void;
  /** Qué mazos aún tienen la jugada gratis de hoy. */
  freeByDeck: Record<number, boolean>;
  /** Bloqueado mientras se procesa una jugada de este mazo. */
  disabled?: boolean;
}

/**
 * Selector único de mazo. Es controlado: GameShell posee el deckSize y todo el
 * lobby (premio, elegibilidad, top 3) cambia junto con esta única elección.
 */
export default function DeckSelector({
  value,
  onChange,
  freeByDeck,
  disabled,
}: Props) {
  const t = useT();

  return (
    <div className="field">
      <label id="deck-selector-label">{t("deck.label")}</label>
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
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {option}
            <small className="deck-price">
              {freeByDeck[option] ? t("common.free") : "0.10 USDT"}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}
