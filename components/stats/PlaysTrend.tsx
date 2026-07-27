"use client";

import type { TrendPoint } from "@/lib/stats";

interface Props {
  points: TrendPoint[];
}

const MONTHS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "26 jul" a partir de YYYY-MM-DD, sin pasar por Date (la ronda es UTC). */
function shortDate(roundId: string): string {
  const [, month, day] = roundId.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`;
}

/**
 * Partidas por ronda de los últimos 30 días. Barras en CSS y no SVG: escalan
 * solas con el ancho de la tarjeta y heredan los colores de la marca.
 *
 * La parte oscura de cada barra son las jugadas PAGAS; el resto, las gratis.
 */
export default function PlaysTrend({ points }: Props) {
  const max = Math.max(...points.map((p) => p.plays), 0);
  const total = points.reduce((sum, p) => sum + p.plays, 0);

  if (max === 0) {
    return (
      <p className="empty-note">
        Todavía no hay partidas en los últimos 30 días.
      </p>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="trend">
      <div
        className="trend-bars"
        role="img"
        aria-label={`Partidas por día en los últimos 30 días: ${total} en total, con un máximo de ${max} en un día.`}
      >
        {points.map((p) => {
          const height = (p.plays / max) * 100;
          const paidShare = p.plays > 0 ? (p.paidPlays / p.plays) * 100 : 0;
          return (
            <div className="trend-col" key={p.roundId}>
              <div
                className="trend-bar"
                style={{ height: `${height}%` }}
                title={`${shortDate(p.roundId)} · ${p.plays} partidas (${p.paidPlays} pagas) · ${p.players} jugadores`}
              >
                <span
                  className="trend-bar-paid"
                  style={{ height: `${paidShare}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="trend-axis">
        <span>{shortDate(first.roundId)}</span>
        <span>{shortDate(last.roundId)} (hoy)</span>
      </div>

      <div className="trend-legend">
        <span className="trend-key">
          <span className="trend-swatch is-paid" aria-hidden="true" /> Pagas
        </span>
        <span className="trend-key">
          <span className="trend-swatch is-free" aria-hidden="true" /> Gratis
        </span>
      </div>
    </div>
  );
}
