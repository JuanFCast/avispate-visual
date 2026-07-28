"use client";

import { useState } from "react";
import { DEFAULT_DECK_SIZE, DECK_OPTIONS } from "@/lib/game";
import { useT } from "@/lib/i18n/client";

interface Props {
  onStart: (deckSize: number) => void;
  /** Qué mazos aún tienen la jugada gratis de hoy. */
  freeByDeck?: Record<number, boolean>;
  /** Error del flujo de pago, si lo hubo. */
  payError?: string | null;
}

export default function PlayerForm({ onStart, freeByDeck = {}, payError }: Props) {
  const t = useT();
  const [deckSize, setDeckSize] = useState(DEFAULT_DECK_SIZE);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onStart(deckSize);
  }

  const isFree = freeByDeck[deckSize];

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="field">
        <label>{t("deck.label")}</label>
        <div className="rounds-options">
          {DECK_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === deckSize ? "selected" : ""}
              onClick={() => setDeckSize(option)}
            >
              {option}
              <small className="deck-price">
                {freeByDeck[option] ? t("common.free") : "0.10 USDT"}
              </small>
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary">
        {isFree ? t("cta.free.label") : t("form.pay_and_play")}
      </button>

      {payError && <p className="alias-error">{payError}</p>}

      <p className="hint">
        {isFree ? t("form.hint.free") : t("form.hint.paid")}{" "}
        {t("form.hint.tail")}
      </p>
    </form>
  );
}
