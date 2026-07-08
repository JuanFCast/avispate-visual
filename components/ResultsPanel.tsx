"use client";

import type { GameResult } from "@/lib/game";

interface Props {
  result: GameResult;
  position: number;
  bestScore: number;
  isNewRecord: boolean;
  onPlayAgain: () => void;
  onChangePlayer: () => void;
}

export default function ResultsPanel({
  result,
  position,
  bestScore,
  isNewRecord,
  onPlayAgain,
  onChangePlayer,
}: Props) {
  return (
    <div className="panel">
      {isNewRecord && (
        <p className="rank-note">🔥 ¡Nuevo récord personal, {result.playerName}!</p>
      )}
      {!isNewRecord && position > 0 && (
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
          <span className="stat-label">Precisión</span>
          <span className="stat-value">{result.accuracy}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Cartas acertadas</span>
          <span className="stat-value">{result.correct}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Errores</span>
          <span className="stat-value">{result.errors}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Mejor combo</span>
          <span className="stat-value">x{result.maxCombo}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Mejor marca</span>
          <span className="stat-value">{bestScore}</span>
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
