"use client";

import { useState } from "react";
import { DEFAULT_DECK_SIZE, DECK_OPTIONS } from "@/lib/game";

interface Props {
  onStart: (deckSize: number) => void;
  /** Qué mazos aún tienen la jugada gratis de hoy. */
  freeByDeck?: Record<number, boolean>;
  /** Error del flujo de pago, si lo hubo. */
  payError?: string | null;
}

export default function PlayerForm({ onStart, freeByDeck = {}, payError }: Props) {
  const [deckSize, setDeckSize] = useState(DEFAULT_DECK_SIZE);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onStart(deckSize);
  }

  const isFree = freeByDeck[deckSize];

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="field">
        <label>Cartas del mazo</label>
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
                {freeByDeck[option] ? "gratis" : "0.10 USDT"}
              </small>
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary">
        {isFree ? "Jugar gratis" : "Pagar 0.10 USDT y jugar"}
      </button>

      {payError && <p className="alias-error">{payError}</p>}

      <p className="hint">
        {isFree
          ? "Tu primera jugada del día en este mazo es gratis. ¡El #1 se lleva el pozo!"
          : "Ya usaste tu jugada gratis de hoy en este mazo. El 80% de tu pago va al pozo."}{" "}
        Cada error suma 1 segundo, ¡así que ojo avispa! 🐝
      </p>
    </form>
  );
}
