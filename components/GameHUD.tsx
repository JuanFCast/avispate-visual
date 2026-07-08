"use client";

import { formatMs } from "@/lib/game";

interface Props {
  elapsedMs: number;
  cardsLeft: number;
  errors: number;
}

export default function GameHUD({ elapsedMs, cardsLeft, errors }: Props) {
  return (
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
  );
}
