"use client";

import { useState } from "react";
import { DEFAULT_ROUNDS, ROUND_OPTIONS } from "@/lib/game";

interface Props {
  initialName: string;
  onStart: (name: string, rounds: number) => void;
}

export default function PlayerForm({ initialName, onStart }: Props) {
  const [name, setName] = useState(initialName);
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onStart(trimmed, rounds);
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
        <label>Rondas</label>
        <div className="rounds-options">
          {ROUND_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === rounds ? "selected" : ""}
              onClick={() => setRounds(option)}
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
        En cada ronda verás dos cartas circulares. Entre ambas hay exactamente{" "}
        <strong>un símbolo en común</strong>: tócalo lo más rápido posible. Cada
        error suma 1 segundo de penalización.
      </p>
    </form>
  );
}
