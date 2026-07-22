"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DECK_OPTIONS, formatMs } from "@/lib/game";
import { shortAddress } from "@/lib/wallet";

interface Entry {
  alias: string;
  walletAddress: string | null;
  averageMs: number;
  errors: number;
  totalMs: number;
}

interface Props {
  /** Mazo con el que abre el ranking; el usuario puede cambiar de pestaña. */
  initialDeck?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

async function fetchLeaderboard(deck: number): Promise<Entry[]> {
  const res = await fetch(`/api/leaderboard?deck=${deck}`);
  if (!res.ok) throw new Error("leaderboard_fetch_failed");
  const data = await res.json();
  return data.leaderboard ?? [];
}

export default function GlobalLeaderboard({ initialDeck = 10 }: Props) {
  // El ranking tiene su propio mazo seleccionado, independiente de a qué juegas.
  const [deck, setDeck] = useState(initialDeck);

  // Si el mazo de contexto cambia (p. ej. acabas de jugar 20), abre esa pestaña.
  useEffect(() => {
    setDeck(initialDeck);
  }, [initialDeck]);

  // react-query cachea por mazo: cambiar de pestaña 10/15/20 es instantáneo tras
  // la primera carga, y tras subir un puntaje invalidamos para refrescar.
  const { data: entries = [], status } = useQuery({
    queryKey: ["leaderboard", deck],
    queryFn: () => fetchLeaderboard(deck),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  return (
    <div className="panel">
      <h2 className="lb-title">🌎 Ranking global</h2>
      <div className="rounds-options lb-tabs" role="tablist" aria-label="Tamaño de mazo">
        {DECK_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === deck}
            className={option === deck ? "selected" : ""}
            onClick={() => setDeck(option)}
          >
            {option} cartas
          </button>
        ))}
      </div>
      {status === "pending" && <p className="empty-note">Cargando ranking…</p>}
      {status === "error" && (
        <p className="empty-note">No se pudo cargar el ranking global.</p>
      )}
      {status === "success" && entries.length === 0 && (
        <p className="empty-note">Aún no hay marcas para este mazo. ¡Sé el primero!</p>
      )}
      {status === "success" && entries.length > 0 && (
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
