"use client";

import { useEffect, useState } from "react";
import { formatMs } from "@/lib/game";
import { shortAddress } from "@/lib/wallet";

interface Entry {
  alias: string;
  walletAddress: string | null;
  averageMs: number;
  errors: number;
  totalMs: number;
}

interface Props {
  /** Tamaño de mazo del ranking a mostrar. */
  deckSize: number;
  /** Cambiar este valor fuerza recargar (p. ej. tras subir un puntaje). */
  refreshKey?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function GlobalLeaderboard({ deckSize, refreshKey }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    fetch(`/api/leaderboard?deck=${deckSize}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!alive) return;
        setEntries(data.leaderboard ?? []);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [deckSize, refreshKey]);

  return (
    <div className="panel">
      <h2 className="lb-title">🌎 Ranking global · mazo {deckSize}</h2>
      {status === "loading" && <p className="empty-note">Cargando ranking…</p>}
      {status === "error" && (
        <p className="empty-note">No se pudo cargar el ranking global.</p>
      )}
      {status === "ready" && entries.length === 0 && (
        <p className="empty-note">Aún no hay marcas para este mazo. ¡Sé el primero!</p>
      )}
      {status === "ready" && entries.length > 0 && (
        <ol className="lb-list">
          {entries.map((entry, i) => {
            const classes = ["lb-row"];
            if (i < 3) classes.push(`top-${i + 1}`);
            return (
              <li key={`${entry.alias}-${i}`} className={classes.join(" ")}>
                <span className="lb-rank">{MEDALS[i] ?? i + 1}</span>
                <span className="lb-name">
                  <span>{entry.alias}</span>
                  <small>
                    {entry.walletAddress
                      ? shortAddress(entry.walletAddress)
                      : "sin wallet"}{" "}
                    · {entry.errors} err
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
