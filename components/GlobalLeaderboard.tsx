"use client";

import { useEffect, useState } from "react";
import { DECK_OPTIONS, formatMs } from "@/lib/game";
import { shortAddress, useActiveWallet } from "@/lib/wallet";
import { useProfile } from "@/lib/profile-context";
import {
  fmtUsdt,
  roundCopy,
  useDeckPot,
  useLeaderboard,
  useRoundClock,
  type LeaderboardEntry as Entry,
} from "@/lib/round";
import { useT } from "@/lib/i18n/client";

interface Props {
  /** Mazo con el que abre; el usuario puede cambiar de pestaña. */
  initialDeck?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function GlobalLeaderboard({ initialDeck = 10 }: Props) {
  const t = useT();
  const [deck, setDeck] = useState(initialDeck);
  useEffect(() => {
    setDeck(initialDeck);
  }, [initialDeck]);

  const { alias } = useProfile();
  const { address } = useActiveWallet();
  const me = (address || "").toLowerCase();
  const clock = useRoundClock(deck);
  const clockCopy = roundCopy(clock, t);

  const { data: entries = [], status } = useLeaderboard(deck);
  const { potUnits, potEnabled } = useDeckPot(deck);

  function isMe(entry: Entry): boolean {
    if (me && entry.walletAddress && entry.walletAddress.toLowerCase() === me)
      return true;
    return Boolean(alias && entry.alias === alias);
  }

  return (
    <div className="panel">
      <div
        className="rounds-options lb-tabs"
        role="tablist"
        aria-label={t("lb.tabs_aria")}
      >
        {DECK_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === deck}
            className={option === deck ? "selected" : ""}
            onClick={() => setDeck(option)}
          >
            {t("lb.cards", { n: option })}
          </button>
        ))}
      </div>

      {potEnabled && (
        <div className="pot-banner">
          <span className="pot-label">{t("lb.pot_label")}</span>
          <span className="pot-amount">{fmtUsdt(potUnits as bigint | undefined)} USDT</span>
          <span className="pot-timer">⏳ {clockCopy.primary}</span>
          {clockCopy.retry ? (
            <button
              type="button"
              className="pot-retry"
              onClick={clock.refetch}
            >
              {clockCopy.secondary}
            </button>
          ) : (
            clockCopy.secondary && (
              <span className="pot-hint" aria-live="polite">
                {clockCopy.secondary}
              </span>
            )
          )}
        </div>
      )}

      <h2 className="lb-title">{t("lb.title", { deck })}</h2>
      {status === "pending" && (
        <p className="empty-note">{t("lb.loading")}</p>
      )}
      {status === "error" && <p className="empty-note">{t("lb.error")}</p>}
      {status === "success" && entries.length === 0 && (
        <p className="empty-note">{t("lb.empty")}</p>
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
                    {isMe(entry) && (
                      <span className="lb-you">{t("top3.you")}</span>
                    )}
                  </span>
                  <small>
                    {entry.walletAddress
                      ? shortAddress(entry.walletAddress)
                      : t("lb.no_wallet")}{" "}
                    · {entry.errors} {t("lb.err")}
                  </small>
                </span>
                <span className="lb-time">
                  {formatMs(entry.averageMs)}
                  <small>
                    {formatMs(entry.totalMs)} {t("lb.total")}
                  </small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
