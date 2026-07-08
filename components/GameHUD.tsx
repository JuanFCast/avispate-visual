"use client";

interface Props {
  timeLeftMs: number;
  score: number;
  combo: number;
  errors: number;
}

export default function GameHUD({ timeLeftMs, score, combo, errors }: Props) {
  const secondsLeft = Math.ceil(timeLeftMs / 1000);
  const urgent = timeLeftMs > 0 && timeLeftMs < 6000;

  return (
    <div className="hud">
      <div className="hud-item">
        <span className="hud-label">Tiempo</span>
        <span className={`hud-value${urgent ? " warn" : ""}`}>
          {secondsLeft}s
        </span>
      </div>
      <div className="hud-item">
        <span className="hud-label">Puntos</span>
        <span className="hud-value">{score}</span>
      </div>
      <div className="hud-item">
        <span className="hud-label">Combo</span>
        <span className={`hud-value${combo >= 3 ? " hot" : ""}`}>
          x{combo}
        </span>
      </div>
      <div className="hud-item">
        <span className="hud-label">Errores</span>
        <span className="hud-value">{errors}</span>
      </div>
    </div>
  );
}
