"use client";

import Link from "next/link";
import { formatMs } from "@/lib/game";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import { useLeaderboard, type LeaderboardEntry } from "@/lib/round";
import { useT } from "@/lib/i18n/client";

/**
 * Top 3 del mazo elegido en el lobby. Sin tabs propios (sigue al selector
 * principal) y sin premio ni contador: esos viven en la tarjeta del reto.
 * El ranking completo queda en /ranking.
 *
 * Si el jugador no entró al podio se añade una cuarta fila destacada con su
 * posición real: mismo formato que las demás (insignia, alias, métricas y
 * tiempo) y la posición solo en la insignia, nunca repetida en el texto.
 */
export default function LeaderboardPreview({ deck }: { deck: number }) {
  const t = useT();
  const { status, data: entries = [] } = useLeaderboard(deck);
  const { alias } = useProfile();
  const { address } = useActiveWallet();
  const me = (address || "").toLowerCase();

  function isMe(entry: LeaderboardEntry): boolean {
    if (me && entry.walletAddress && entry.walletAddress.toLowerCase() === me)
      return true;
    return Boolean(alias && entry.alias === alias);
  }

  const myIndex = entries.findIndex(isMe);
  const mine = myIndex >= 3 ? entries[myIndex] : null;

  return (
    <section className="lobby-top3" aria-label={t("top3.title")}>
      <h2 className="lobby-top3-title">{t("top3.title")}</h2>

      {status === "pending" && (
        <ul className="lobby-rows" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="lobby-row lobby-row-skeleton">
              <span className="skeleton lobby-skeleton-line" />
            </li>
          ))}
        </ul>
      )}

      {status === "error" && (
        <p className="lobby-note">
          {t("top3.error")}{" "}
          <Link href={`/ranking?deck=${deck}`}>{t("common.view_ranking")}</Link>
        </p>
      )}

      {status === "success" && entries.length === 0 && (
        <p className="lobby-note">{t("top3.empty")}</p>
      )}

      {status === "success" && entries.length > 0 && (
        <ol className="lobby-rows">
          {entries.slice(0, 3).map((entry, i) => (
            <li
              key={`${entry.alias}-${i}`}
              className={`lobby-row${isMe(entry) ? " me" : ""}`}
            >
              <span className="lobby-rank" aria-hidden="true">
                {i + 1}
              </span>
              <span className="lobby-row-name">
                <span>
                  {entry.alias}
                  {isMe(entry) && <span className="lb-you">{t("top3.you")}</span>}
                </span>
                <small>
                  {entry.errors} {t("top3.err")} · {formatMs(entry.totalMs)}{" "}
                  {t("top3.total")}
                </small>
              </span>
              <span className="lobby-row-time">
                {formatMs(entry.averageMs)}
                <small>{t("top3.avg")}</small>
              </span>
            </li>
          ))}
          {mine && (
            <li className="lobby-row me lobby-row-mine">
              <span className="lobby-rank" aria-hidden="true">
                {myIndex + 1}
              </span>
              <span className="lobby-row-name">
                <span className="lobby-row-alias">
                  {mine.alias}
                  <span className="lobby-you-label">{t("top3.you_label")}</span>
                </span>
                <small>
                  {mine.errors} {t("top3.err")} · {formatMs(mine.totalMs)}{" "}
                  {t("top3.total")}
                </small>
              </span>
              <span className="lobby-row-time">
                {formatMs(mine.averageMs)}
                <small>{t("top3.avg")}</small>
              </span>
            </li>
          )}
        </ol>
      )}

      <Link className="lobby-ranking-link" href={`/ranking?deck=${deck}`}>
        {t("top3.full")}
      </Link>
    </section>
  );
}
