"use client";

import { formatMs, type GameResult } from "@/lib/game";

interface Props {
  result: GameResult;
  position: number;
  onPlayAgain: () => void;
  onChangePlayer: () => void;
}

export default function ResultsPanel({
  result,
  position,
  onPlayAgain,
  onChangePlayer,
}: Props) {
  return (
    <div className="panel">
      {position > 0 && (
        <p className="rank-note">
          🏆 {result.playerName}, quedaste en el puesto #{position} del ranking
        </p>
      )}

      <div className="stats-grid">
        <div className="stat highlight">
          <span className="stat-label">Puntaje</span>
          <span className="stat-value">{result.score}</span>
        </div>
        <div className="stat highlight">
          <span className="stat-label">Tiempo total</span>
          <span className="stat-value">{formatMs(result.totalMs)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Promedio / ronda</span>
          <span className="stat-value">{formatMs(result.averageMs)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Mejor racha</span>
          <span className="stat-value">{result.maxStreak}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Aciertos</span>
          <span className="stat-value">{result.correct}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Errores</span>
          <span className="stat-value">{result.errors}</span>
        </div>
      </div>

      <button type="button" className="btn-primary" onClick={onPlayAgain}>
        Jugar otra vez
      </button>
      <button type="button" className="btn-secondary" onClick={onChangePlayer}>
        Cambiar jugador
      </button>
    </div>
  );
}
