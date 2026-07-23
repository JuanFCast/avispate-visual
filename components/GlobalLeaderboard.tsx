"use client";

import { useEffect, useState } from "react";
import { DECK_OPTIONS, formatMs } from "@/lib/game";
import { shortAddress, useActiveWallet } from "@/lib/wallet";
import { useProfile } from "@/lib/profile-context";
import {
  fmtUsdt,
  useDeckPot,
  useLeaderboard,
  useRoundCountdown,
  type LeaderboardEntry as Entry,
} from "@/lib/round";

interface Props {
  /** Mazo con el que abre; el usuario puede cambiar de pestaña. */
  initialDeck?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function GlobalLeaderboard({ initialDeck = 10 }: Props) {
  const [deck, setDeck] = useState(initialDeck);
  useEffect(() => {
    setDeck(initialDeck);
  }, [initialDeck]);

  const { alias } = useProfile();
  const { address } = useActiveWallet();
  const me = (address || "").toLowerCase();
  const countdown = useRoundCountdown();

  const { data: entries = [], status } = useLeaderboard(deck);
  const { potUnits, potEnabled } = useDeckPot(deck);

  function isMe(entry: Entry): boolean {
    if (me && entry.walletAddress && entry.walletAddress.toLowerCase() === me)
      return true;
    return Boolean(alias && entry.alias === alias);
  }

  return (
    <div className="panel">
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

      {potEnabled && (
        <div className="pot-banner">
          <span className="pot-label">🏆 Premio de hoy · el #1 se lo lleva todo</span>
          <span className="pot-amount">{fmtUsdt(potUnits as bigint | undefined)} USDT</span>
          <span className="pot-timer">⏳ cierra en {countdown} · 7pm (Col)</span>
        </div>
      )}

      <h2 className="lb-title">Ranking de hoy · mazo {deck}</h2>
      {status === "pending" && <p className="empty-note">Cargando ranking…</p>}
      {status === "error" && (
        <p className="empty-note">No se pudo cargar el ranking.</p>
      )}
      {status === "success" && entries.length === 0 && (
        <p className="empty-note">Aún no hay marcas hoy. ¡Sé el primero y gana el pozo!</p>
      )}
      {status === "success" && entries.length > 0 && (
        <ol className="lb-list">
          {entries.map((entry, i) => {
            const classes = ["lb-row"];
            if (i < 3) classes.push(`top-${i + 1}`);
            if (isMe(entry)) classes.push("me");
            return (
              <li key={`${entry.alias}-${i}`} className={classes.join(" ")}>
                <span className="lb-rank">{MEDALS[i] ?? i + 1}</span>
                <span className="lb-name">
                  <span>
                    {entry.alias}
                    {isMe(entry) && <span className="lb-you">TÚ</span>}
                  </span>
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
