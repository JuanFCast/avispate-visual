"use client";

import { useState } from "react";
import { DEFAULT_DURATION_S, DURATION_OPTIONS } from "@/lib/game";

interface Props {
  initialName: string;
  onStart: (name: string, durationS: number) => void;
}

export default function PlayerForm({ initialName, onStart }: Props) {
  const [name, setName] = useState(initialName);
  const [duration, setDuration] = useState(DEFAULT_DURATION_S);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onStart(trimmed, duration);
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
        <label>Duración de la partida</label>
        <div className="rounds-options">
          {DURATION_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === duration ? "selected" : ""}
              onClick={() => setDuration(option)}
            >
              {option}s
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary" disabled={!name.trim()}>
        Iniciar partida
      </button>

      <p className="hint">
        Las cartas fluyen en cadena: entre la carta base y la nueva siempre hay{" "}
        <strong>un símbolo en común</strong>. Tócalo y la carta avanza. Cada
        acierto seguido sube tu combo; si fallas, pierdes el combo y unos
        puntos. ¡Pasa todas las cartas que puedas antes de que acabe el tiempo!
      </p>
    </form>
  );
}
