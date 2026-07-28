"use client";

import type { TrendPoint } from "@/lib/stats";
import { useI18n } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n";

interface Props {
  points: TrendPoint[];
}

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun",
       "jul", "ago", "sep", "oct", "nov", "dic"],
};

/** "26 jul" a partir de YYYY-MM-DD, sin pasar por Date (la ronda es UTC). */
function shortDate(roundId: string, lang: Lang): string {
  const [, month, day] = roundId.split("-");
  return `${Number(day)} ${MONTHS[lang][Number(month) - 1] ?? ""}`;
}

/**
 * Partidas por ronda de los últimos 30 días. Barras en CSS y no SVG: escalan
 * solas con el ancho de la tarjeta y heredan los colores de la marca.
 *
 * La parte oscura de cada barra son las jugadas PAGAS; el resto, las gratis.
 */
export default function PlaysTrend({ points }: Props) {
  const { t, lang } = useI18n();
  const max = Math.max(...points.map((p) => p.plays), 0);
  const total = points.reduce((sum, p) => sum + p.plays, 0);

  if (max === 0) {
    return <p className="empty-note">{t("stats.trend.empty")}</p>;
  }

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="trend">
      <div
        className="trend-bars"
        role="img"
        aria-label={t("stats.trend.aria", { total, max })}
      >
        {points.map((p) => {
          const height = (p.plays / max) * 100;
          const paidShare = p.plays > 0 ? (p.paidPlays / p.plays) * 100 : 0;
          return (
            <div className="trend-col" key={p.roundId}>
              <div
                className="trend-bar"
                style={{ height: `${height}%` }}
                title={t("stats.trend.bar", {
                  date: shortDate(p.roundId, lang),
                  plays: p.plays,
                  paid: p.paidPlays,
                  players: p.players,
                })}
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
        <span>{shortDate(first.roundId, lang)}</span>
        <span>
          {t("stats.trend.today", { date: shortDate(last.roundId, lang) })}
        </span>
      </div>

      <div className="trend-legend">
        <span className="trend-key">
          <span className="trend-swatch is-paid" aria-hidden="true" />{" "}
          {t("stats.trend.paid")}
        </span>
        <span className="trend-key">
          <span className="trend-swatch is-free" aria-hidden="true" />{" "}
          {t("stats.trend.free")}
        </span>
      </div>
    </div>
  );
}
