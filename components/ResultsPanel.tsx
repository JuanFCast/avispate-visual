"use client";

import { formatMs, type GameResult } from "@/lib/game";
import type { PlayStage } from "@/lib/pay";
import { useT } from "@/lib/i18n/client";
import PlayButton from "./PlayButton";

interface Props {
  result: GameResult;
  bestAverageMs: number;
  isNewRecord: boolean;
  /** Revancha en curso: los resultados siguen a la vista. */
  payStage: PlayStage | null;
  onPlayAgain: () => void;
  onChangePlayer: () => void;
}

export default function ResultsPanel({
  result,
  bestAverageMs,
  isNewRecord,
  payStage,
  onPlayAgain,
  onChangePlayer,
}: Props) {
  const t = useT();

  return (
    <div className="panel">
      {isNewRecord && (
        <p className="rank-note">
          {t("results.record", { name: result.playerName })}
        </p>
      )}

      <div className="stats-grid">
        <div className="stat highlight">
          <span className="stat-label">{t("results.total_time")}</span>
          <span className="stat-value">{formatMs(result.totalMs)}</span>
        </div>
        <div className="stat highlight">
          <span className="stat-label">{t("results.avg_card")}</span>
          <span className="stat-value">{formatMs(result.averageMs)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("results.cards")}</span>
          <span className="stat-value">{result.cards}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("results.errors")}</span>
          <span className="stat-value">{result.errors}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("results.accuracy")}</span>
          <span className="stat-value">{result.accuracy}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("results.best_avg")}</span>
          <span className="stat-value">{formatMs(bestAverageMs)}</span>
        </div>
      </div>

      <PlayButton
        label={t("results.play_again")}
        stage={payStage}
        onClick={onPlayAgain}
      />
      <button
        type="button"
        className="btn-secondary"
        disabled={payStage !== null}
        onClick={onChangePlayer}
      >
        {t("results.back")}
      </button>
    </div>
  );
}
