"use client";

import { useT } from "@/lib/i18n/client";

/**
 * Entradas previstas para la Arena. Son solo informativas: todavía no hay
 * mesas ni cobros, así que se pintan como fichas y no como botones — nada
 * aquí se puede tocar y nada promete un precio final.
 */
export const ARENA_ENTRIES = ["0.10", "0.50", "1"] as const;

export default function ArenaEntries({ label }: { label?: string }) {
  const t = useT();

  return (
    <div className="arena-entries">
      <span className="arena-entries-label">
        {label ?? t("arena.entries.label")}
      </span>
      <ul className="arena-entry-list">
        {ARENA_ENTRIES.map((amount) => (
          <li key={amount} className="arena-entry">
            <span className="arena-entry-amount">{amount}</span>
            <small>USDT</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
