"use client";

import { useState } from "react";
import { DEFAULT_DECK_SIZE, DECK_OPTIONS } from "@/lib/game";

interface Props {
  initialName: string;
  onStart: (name: string, deckSize: number) => void;
}

export default function PlayerForm({ initialName, onStart }: Props) {
  const [name, setName] = useState(initialName);
  const [deckSize, setDeckSize] = useState(DEFAULT_DECK_SIZE);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onStart(trimmed, deckSize);
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="player-name">Tu nombre o alias</label>
        <input
          id="player-name"
          type="text"
          value={name}
          maxLength={20}
          placeholder="Ej: Vale"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

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

      <button type="submit" className="btn-primary" disabled={!name.trim()}>
        Iniciar partida
      </button>

      <p className="hint">
        Tienes un mazo de cartas y una carta base que no se toca. Encuentra en{" "}
        <strong>tu carta</strong> el símbolo que comparte con la base y tócalo:
        tu carta pasa a ser la nueva base y sale la siguiente del mazo. Cada
        error suma 1 segundo. ¡Gasta todo el mazo en el menor tiempo posible!
      </p>
    </form>
  );
}
