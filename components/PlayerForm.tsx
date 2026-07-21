"use client";

import { useState } from "react";
import { DEFAULT_DECK_SIZE, DECK_OPTIONS } from "@/lib/game";

interface Props {
  onStart: (deckSize: number) => void;
}

export default function PlayerForm({ onStart }: Props) {
  const [deckSize, setDeckSize] = useState(DEFAULT_DECK_SIZE);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onStart(deckSize);
  }

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
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary">
        Iniciar partida
      </button>

      <p className="hint">
        Tu carta y la base siempre comparten <strong>un símbolo</strong>. Cada
        error suma 1 segundo, ¡así que ojo avispa! 🐝
      </p>
    </form>
  );
}
