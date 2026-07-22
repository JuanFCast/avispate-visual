"use client";

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
  return (
    <section className="stats-grid" aria-label="Estadísticas">
      <div className="stat-card tint-games">
        <span className="stat-value">
          {loading ? <span className="skeleton skeleton-num" /> : gamesPlayed}
        </span>
        <span className="stat-label">Partidas</span>
      </div>
      <div className="stat-card tint-wins">
        <span className="stat-value">
          {loading ? <span className="skeleton skeleton-num" /> : wins}
        </span>
        <span className="stat-label">Victorias</span>
      </div>
      <div className="stat-card tint-won">
        <span className="stat-label">Total ganado</span>
        {loading ? (
          <span className="skeleton skeleton-line" />
        ) : (
          <span className="stat-won-value">{totalWonUsdt} USDT</span>
        )}
      </div>
    </section>
  );
}
