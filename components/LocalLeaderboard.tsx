"use client";

import type { GameResult } from "@/lib/game";

interface Props {
  entries: GameResult[];
  /** Posición (1-based) a resaltar, p. ej. el resultado recién jugado. */
  highlightPosition?: number;
}

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
      <h2 style={{ fontSize: "1.1rem" }}>🏅 Ranking local</h2>
      {entries.length === 0 ? (
        <p className="empty-note">
          Aún no hay partidas. ¡Sé la primera persona en el ranking!
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre</th>
                <th>Puntos</th>
                <th>Cartas</th>
                <th>Prec.</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={`${entry.createdAt}-${i}`}
                  className={i + 1 === highlightPosition ? "me" : ""}
                >
                  <td className="num">{i + 1}</td>
                  <td>{entry.playerName}</td>
                  <td className="num">{entry.score}</td>
                  <td className="num">{entry.correct}</td>
                  <td className="num">{entry.accuracy}%</td>
                  <td>{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
