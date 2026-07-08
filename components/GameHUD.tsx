"use client";

import { formatMs } from "@/lib/game";

interface Props {
  elapsedMs: number;
  cardsLeft: number;
  deckSize: number;
  errors: number;
}

export default function GameHUD({
  elapsedMs,
  cardsLeft,
  deckSize,
  errors,
}: Props) {
  const spent = deckSize - cardsLeft;

  return (
    <>
      <div className="hud">
        <div className="hud-item">
          <span className="hud-label">Tiempo</span>
          <span className="hud-value">{formatMs(elapsedMs)}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Cartas</span>
          <span className="hud-value">{cardsLeft}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Errores</span>
          <span className="hud-value">{errors}</span>
        </div>
      </div>
      <div className="progress-wrap">
        <span className="progress-label">
          Ronda {Math.min(spent + 1, deckSize)} de {deckSize}
        </span>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={deckSize}
          aria-valuenow={spent}
        >
          <div
            className="progress-fill"
            style={{ width: `${(spent / deckSize) * 100}%` }}
          />
        </div>
      </div>
    </>
  );
}
