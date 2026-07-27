import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  /** Línea de apoyo: el desglose o la unidad de la cifra. */
  hint?: ReactNode;
  tint?: "yellow" | "cyan" | "good" | "plain";
  loading?: boolean;
}

/**
 * Cifra suelta del panel. Sin la cifra todavía (`loading`) reserva su alto para
 * que el panel no salte al llegar los datos.
 */
export default function StatTile({
  label,
  value,
  hint,
  tint = "plain",
  loading = false,
}: Props) {
  return (
    <div className={`stats-tile tint-${tint}`}>
      <span className="stats-tile-label">{label}</span>
      <span className="stats-tile-value">
        {loading ? <span className="skeleton stats-tile-skeleton" /> : value}
      </span>
      {hint && <span className="stats-tile-hint">{hint}</span>}
    </div>
  );
}
