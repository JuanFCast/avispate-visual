"use client";

import Link from "next/link";
import { formatMs } from "@/lib/game";
import type { MatchPlayerView, MatchView } from "@/lib/arena-match";
import { matchResultFor, standingsOf } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import type { MessageKey, Translate } from "@/lib/i18n";

/** "2º" en español, "2nd" en inglés. Nunca hay más de cuatro sillas. */
function ordinal(place: number, t: Translate): string {
  const key = `match.ord.${Math.min(Math.max(place, 1), 4)}` as MessageKey;
  return t(key);
}

/**
 * Final de la partida: en qué puesto quedaste y por qué.
 *
 * Enseña las cuatro cifras de TODOS en la misma tabla, ordenada por puesto.
 * Perder sabiendo que fue por dos cartas de castigo es información; perder
 * viendo solo "perdiste" es una pared. Con tres o cuatro en la mesa hace falta
 * además el puesto: quedar segundo de cuatro y quedar último son dos partidas
 * distintas y "Perdiste" las cuenta igual.
 *
 * Y como no hay dinero en juego todavía, la pantalla lo dice en vez de dejar
 * que alguien lo suponga.
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

  const standings = standingsOf(view);
  const many = standings.length > 2;
  const place = standings.findIndex((p) => p.isYou) + 1;
  const winner = standings.find((p) => p.profileId === view.winnerProfileId);

  /**
   * Con un rival, "tu rival" señala a alguien. Con tres deja de señalar, así
   * que se dice el nombre de quien ganó.
   */
  const lead = abandoned
    ? won
      ? many
        ? t("match.over.everyone_left")
        : t("match.over.rival_left")
      : t("match.over.you_left")
    : won
      ? t("match.over.won_text")
      : many && winner
        ? t("match.over.lost_many", { name: winner.name || t("room.players.anon") })
        : t("match.over.lost_text");

  return (
    <section className={`arena-card match-over${won ? " won" : ""}`}>
      <span className="match-over-emoji" aria-hidden="true">
        {won ? "🏆" : "🐝"}
      </span>
      <h1 className="match-over-title">
        {won ? t("match.over.won") : t("match.over.lost")}
      </h1>
      {/* El puesto solo aparece cuando hay puestos que repartir: en una mesa de
          dos, "quedaste 2º de 2" es una forma rebuscada de decir "perdiste". */}
      {many && place > 0 && !won && (
        <p className="match-over-rank">
          {t("match.over.rank", {
            place: ordinal(place, t),
            total: standings.length,
          })}
        </p>
      )}
      <p className="match-over-lead">{lead}</p>

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
          {standings.map((p) => (
            <Row key={p.profileId} player={p} t={t} winner={view.winnerProfileId} />
          ))}
        </tbody>
      </table>

      <p className="arena-prize-note">{t("match.over.no_prize")}</p>

      {/* Los dos enlaces no van al mismo sitio: la revancha es armar otra sala,
          y volver a la Arena es lo otro que se puede querer hacer. */}
      <Link className="arena-cta" href="/arena/crear">
        {t("match.over.again")}
      </Link>
      <Link className="lobby-ranking-link" href="/arena">
        {t("join.exit.arena")}
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
