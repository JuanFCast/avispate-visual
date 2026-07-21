"use client";

import { formatMs, type GameResult } from "@/lib/game";

interface Props {
  result: GameResult;
  bestAverageMs: number;
  isNewRecord: boolean;
  onPlayAgain: () => void;
  onChangePlayer: () => void;
}

export default function ResultsPanel({
  result,
  bestAverageMs,
  isNewRecord,
  onPlayAgain,
  onChangePlayer,
}: Props) {
  return (
    <div className="panel">
      {isNewRecord && (
        <p className="rank-note">
          🔥 ¡Nuevo récord personal, {result.playerName}!
        </p>
      )}

      <div className="stats-grid">
        <div className="stat highlight">
          <span className="stat-label">Tiempo total</span>
          <span className="stat-value">{formatMs(result.totalMs)}</span>
        </div>
        <div className="stat highlight">
          <span className="stat-label">Prom. por carta</span>
          <span className="stat-value">{formatMs(result.averageMs)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Cartas</span>
          <span className="stat-value">{result.cards}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Errores</span>
          <span className="stat-value">{result.errors}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Precisión</span>
          <span className="stat-value">{result.accuracy}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Mejor prom.</span>
          <span className="stat-value">{formatMs(bestAverageMs)}</span>
        </div>
      </div>

      <button type="button" className="btn-primary" onClick={onPlayAgain}>
        Jugar otra vez
      </button>
      <button type="button" className="btn-secondary" onClick={onChangePlayer}>
        Volver al menú
      </button>
    </div>
  );
}
