"use client";

import { formatMs } from "@/lib/game";

interface Props {
  round: number;
  totalRounds: number;
  elapsedMs: number;
  errors: number;
  points: number;
}

export default function GameHUD({
  round,
  totalRounds,
  elapsedMs,
  errors,
  points,
}: Props) {
  return (
    <div className="hud">
      <div className="hud-item">
        <span className="hud-label">Ronda</span>
        <span className="hud-value">
          {round}/{totalRounds}
        </span>
      </div>
      <div className="hud-item">
        <span className="hud-label">Tiempo</span>
        <span className="hud-value">{formatMs(elapsedMs)}</span>
      </div>
      <div className="hud-item">
        <span className="hud-label">Errores</span>
        <span className="hud-value">{errors}</span>
      </div>
      <div className="hud-item">
        <span className="hud-label">Puntos</span>
        <span className="hud-value">{points}</span>
      </div>
    </div>
  );
}
