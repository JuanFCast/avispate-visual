"use client";

import { formatMs, type GameResult } from "@/lib/game";

interface Props {
  entries: GameResult[];
  /** Posición (1-based) a resaltar, p. ej. el resultado recién jugado. */
  highlightPosition?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

export default function LocalLeaderboard({
  entries,
  highlightPosition,
}: Props) {
  return (
    <div className="panel">
      <h2 className="lb-title">🏆 Ranking</h2>
      {entries.length === 0 ? (
        <p className="empty-note">
          Aún no hay partidas. ¡Sé quien estrene el ranking!
        </p>
      ) : (
        <ol className="lb-list">
          {entries.map((entry, i) => {
            const classes = ["lb-row"];
            if (i < 3) classes.push(`top-${i + 1}`);
            if (i + 1 === highlightPosition) classes.push("me");
            return (
              <li key={`${entry.createdAt}-${i}`} className={classes.join(" ")}>
                <span className="lb-rank">{MEDALS[i] ?? i + 1}</span>
                <span className="lb-name">
                  <span>{entry.playerName}</span>
                  <small>
                    {entry.cards} cartas · {entry.errors} err ·{" "}
                    {formatDate(entry.createdAt)}
                  </small>
                </span>
                <span className="lb-time">
                  {formatMs(entry.averageMs)}
                  <small>{formatMs(entry.totalMs)} total</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
