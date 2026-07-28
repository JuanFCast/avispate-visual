"use client";

import { useT } from "@/lib/i18n/client";

interface Props {
  gamesPlayed: number;
  wins: number;
  /** Total ganado en USDT ya formateado (p. ej. "2.50"). */
  totalWonUsdt: string;
  loading: boolean;
}

/** Tres tarjetas: partidas jugadas, victorias y total ganado (por token). */
export default function ProfileStats({
  gamesPlayed,
  wins,
  totalWonUsdt,
  loading,
}: Props) {
  const t = useT();

  return (
    <section className="stats-grid" aria-label={t("profile.stats.aria")}>
      <div className="stat-card tint-games">
        <span className="stat-value">
          {loading ? <span className="skeleton skeleton-num" /> : gamesPlayed}
        </span>
        <span className="stat-label">{t("profile.stats.games")}</span>
      </div>
      <div className="stat-card tint-wins">
        <span className="stat-value">
          {loading ? <span className="skeleton skeleton-num" /> : wins}
        </span>
        <span className="stat-label">{t("profile.stats.wins")}</span>
      </div>
      <div className="stat-card tint-won">
        <span className="stat-label">{t("profile.stats.total_won")}</span>
        {loading ? (
          <span className="skeleton skeleton-line" />
        ) : (
          <span className="stat-won-value">{totalWonUsdt} USDT</span>
        )}
      </div>
    </section>
  );
}
