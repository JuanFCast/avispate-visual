"use client";

import Link from "next/link";
import { formatMs } from "@/lib/game";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import { useLeaderboard, type LeaderboardEntry } from "@/lib/round";

/**
 * Top 3 del mazo elegido en el lobby. Sin tabs propios (sigue al selector
 * principal) y sin premio ni contador: esos viven en la tarjeta del reto.
 * El ranking completo queda en /ranking.
 */
export default function LeaderboardPreview({ deck }: { deck: number }) {
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
    <section className="lobby-top3" aria-label="Los más avispados de hoy">
      <h2 className="lobby-top3-title">Los más avispados de hoy</h2>

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
          No se pudo cargar el top de hoy.{" "}
          <Link href={`/ranking?deck=${deck}`}>Ver ranking</Link>
        </p>
      )}

      {status === "success" && entries.length === 0 && (
        <p className="lobby-note">Todavía no hay marcas. ¡Sé el primero!</p>
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
                  {isMe(entry) && <span className="lb-you">TÚ</span>}
                </span>
                <small>
                  {entry.errors} err · {formatMs(entry.totalMs)} total
                </small>
              </span>
              <span className="lobby-row-time">
                {formatMs(entry.averageMs)}
                <small>promedio por carta</small>
              </span>
            </li>
          ))}
          {mine && (
            <li className="lobby-row me lobby-row-mine">
              <span className="lobby-rank" aria-hidden="true">
                #{myIndex + 1}
              </span>
              <span className="lobby-row-name">
                <span>Tu marca · #{myIndex + 1}</span>
                <small>
                  {mine.errors} err · {formatMs(mine.totalMs)} total
                </small>
              </span>
              <span className="lobby-row-time">
                {formatMs(mine.averageMs)}
                <small>promedio por carta</small>
              </span>
            </li>
          )}
        </ol>
      )}

      <Link className="lobby-ranking-link" href={`/ranking?deck=${deck}`}>
        Ver ranking completo
      </Link>
    </section>
  );
}
