"use client";

import Link from "next/link";
import { fmtUsdt } from "@/lib/arena";
import { formatMs } from "@/lib/game";
import type { MatchPlayerView, MatchStakes, MatchView } from "@/lib/arena-match";
import { matchResultFor, standingsOf } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import type { MessageKey, Translate } from "@/lib/i18n";

/** "2º" en español, "2nd" en inglés. Nunca hay más de cuatro sillas. */
function ordinal(place: number, t: Translate): string {
  const key = `match.ord.${Math.min(Math.max(place, 1), 4)}` as MessageKey;
  return t(key);
}

/**
 * Final de la partida: en qué puesto quedaste, por qué, y qué pasó con la plata.
 *
 * Enseña las cifras de TODOS en la misma tabla, ordenada por puesto. Perder
 * sabiendo que fue por dos cartas de castigo es información; perder viendo solo
 * "perdiste" es una pared. Con tres o cuatro en la mesa hace falta además el
 * puesto: quedar segundo de cuatro y quedar último son dos partidas distintas y
 * "Perdiste" las cuenta igual.
 *
 * Las manos tomadas —cuántas veces cada uno puso su carta sobre la base— son la
 * cifra que faltaba y la que de verdad cuenta la partida: las cartas que quedan
 * dicen dónde terminaste, las tomadas dicen cuánto jugaste para llegar ahí. Van
 * dos veces a propósito: el total arriba, junto al tiempo, porque es la medida
 * de la partida entera; y por jugador en la tabla, porque es la de cada uno.
 *
 * Y el dinero se dice en cifras. Si la mesa cobraba, aquí aparece cuánto se
 * ganó y si el pago ya salió; si no cobraba, se dice eso, que también es una
 * respuesta.
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
  const taken = standings.reduce((sum, p) => sum + p.correct, 0);

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

      <Prize stakes={view.stakes} won={won} winner={winner ?? null} t={t} />

      {/* Las dos medidas de la partida entera, una al lado de la otra. */}
      <dl className="match-over-figures">
        <div className="match-over-figure">
          <dt>{t("match.over.time")}</dt>
          <dd>{formatMs(elapsedMs)}</dd>
        </div>
        <div className="match-over-figure">
          <dt>{t("match.over.taken")}</dt>
          <dd>{taken}</dd>
        </div>
      </dl>

      <table className="match-table">
        <thead>
          <tr>
            <th scope="col">{t("match.table.player")}</th>
            <th scope="col">{t("match.table.taken")}</th>
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

/**
 * Qué pasó con el dinero.
 *
 * Tres pantallas distintas y no una con condicionales dentro del texto: el que
 * ganó una mesa con entrada quiere ver la cifra y saber si ya salió el pago; el
 * que perdió quiere saber cuánto le costó y a quién se lo llevó; y en una mesa
 * gratis lo único honesto es decir que no había nada en juego.
 *
 * El estado del pago no se esconde mientras se confirma. "Va en camino" es la
 * verdad durante los segundos que tarda la cadena, y callarlo dejaría al ganador
 * mirando una pantalla que le prometió plata sin decirle dónde está.
 */
function Prize({
  stakes,
  won,
  winner,
  t,
}: {
  stakes: MatchStakes;
  won: boolean;
  winner: MatchPlayerView | null;
  t: Translate;
}) {
  if (!stakes.paid) {
    return <p className="arena-prize-note">{t("match.over.no_prize")}</p>;
  }

  const prize = fmtUsdt(BigInt(stakes.prizeUnits));
  const entry = fmtUsdt(BigInt(stakes.entryUnits));

  if (!won) {
    return (
      <div className="match-prize lost">
        <p className="match-prize-lead">
          {t("match.over.prize.lost", { amount: entry })}
        </p>
        <p className="match-prize-note">
          {t("match.over.prize.to_winner", {
            name: winner?.name || t("room.players.anon"),
            amount: prize,
          })}
        </p>
      </div>
    );
  }

  const hash = stakes.payout?.txHash ?? null;

  return (
    <div className="match-prize won">
      <span className="match-prize-label">{t("match.over.prize.won")}</span>
      <strong className="match-prize-amount">{prize} USDT</strong>
      <p className="match-prize-note" aria-live="polite">
        {hash ? t("match.over.prize.sent") : t("match.over.prize.sending")}
      </p>
      {hash && (
        <a
          className="match-prize-tx"
          href={`https://celoscan.io/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("match.over.prize.tx")}
        </a>
      )}
    </div>
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
      <td>{player.correct}</td>
      <td>{player.cardsLeft}</td>
      <td>{player.errors}</td>
      <td>{player.penalties}</td>
    </tr>
  );
}
