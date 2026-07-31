"use client";

import Link from "next/link";
import { formatMs } from "@/lib/game";
import type { MatchPlayerView, MatchView } from "@/lib/arena-match";
import { matchResultFor } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";

/**
 * Final de la partida: ganaste o perdiste, y por qué.
 *
 * Enseña las cuatro cifras de los DOS jugadores en la misma tabla. Perder
 * sabiendo que fue por dos cartas de castigo es información; perder viendo solo
 * "perdiste" es una pared. Y como no hay dinero en juego todavía, la pantalla
 * lo dice en vez de dejar que alguien lo suponga.
 */
export default function ArenaMatchOver({
  view,
  elapsedMs,
}: {
  view: MatchView;
  elapsedMs: number;
}) {
  const t = useT();
  const result = matchResultFor(view);
  const won = result === "won";
  const abandoned = view.endReason === "abandoned";

  return (
    <section className={`arena-card match-over${won ? " won" : ""}`}>
      <span className="match-over-emoji" aria-hidden="true">
        {won ? "🏆" : "🐝"}
      </span>
      <h1 className="match-over-title">
        {won ? t("match.over.won") : t("match.over.lost")}
      </h1>
      <p className="match-over-lead">
        {abandoned
          ? won
            ? t("match.over.rival_left")
            : t("match.over.you_left")
          : won
            ? t("match.over.won_text")
            : t("match.over.lost_text")}
      </p>

      <p className="match-over-time">
        <span>{t("match.over.time")}</span>
        <strong>{formatMs(elapsedMs)}</strong>
      </p>

      <table className="match-table">
        <thead>
          <tr>
            <th scope="col">{t("match.table.player")}</th>
            <th scope="col">{t("match.table.left")}</th>
            <th scope="col">{t("match.table.errors")}</th>
            <th scope="col">{t("match.table.penalties")}</th>
          </tr>
        </thead>
        <tbody>
          <Row player={view.you} t={t} winner={view.winnerProfileId} />
          <Row player={view.rival} t={t} winner={view.winnerProfileId} />
        </tbody>
      </table>

      <p className="arena-prize-note">{t("match.over.no_prize")}</p>

      <Link className="arena-cta" href="/arena/privada">
        {t("match.over.again")}
      </Link>
      <Link className="lobby-ranking-link" href="/arena">
        {t("arena.soon.back_lobby")}
      </Link>
    </section>
  );
}

function Row({
  player,
  t,
  winner,
}: {
  player: MatchPlayerView | null;
  t: Translate;
  winner: string | null;
}) {
  if (!player) return null;
  const isWinner = player.profileId === winner;
  return (
    <tr className={isWinner ? "match-row-win" : undefined}>
      <th scope="row">
        <span className="match-row-name">
          {player.name || t("room.players.anon")}
          {player.isYou && <em>{t("match.you")}</em>}
        </span>
        {isWinner && (
          <span className="match-row-crown" aria-label={t("match.table.winner")}>
            🏆
          </span>
        )}
      </th>
      <td>{player.cardsLeft}</td>
      <td>{player.errors}</td>
      <td>{player.penalties}</td>
    </tr>
  );
}
