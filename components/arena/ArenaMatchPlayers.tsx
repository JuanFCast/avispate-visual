"use client";

import type { MatchPlayerView } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";

/**
 * La franja de arriba durante la partida: tú y el rival, uno al lado del otro.
 *
 * Es lo único que el modo individual no tiene y esta fase necesita comprobar —
 * que el progreso del otro se vea moverse en tiempo real—, así que enseña las
 * tres cosas que contestan "¿cómo voy?": quién es, cómo está y cuántas cartas
 * le quedan. El número es grande porque es la carrera.
 */
export default function ArenaMatchPlayers({
  you,
  rival,
}: {
  you: MatchPlayerView | null;
  rival: MatchPlayerView | null;
}) {
  const t = useT();

  return (
    <div className="match-players">
      <PlayerChip player={you} t={t} youLabel={t("match.you")} />
      <span className="match-vs" aria-hidden="true">
        VS
      </span>
      <PlayerChip player={rival} t={t} youLabel={null} />
    </div>
  );
}

function stateOf(player: MatchPlayerView, t: Translate): string {
  if (player.finished) return t("match.state.finished");
  if (player.left) return t("match.state.left");
  if (!player.online) return t("match.state.offline");
  return t("match.state.playing");
}

function PlayerChip({
  player,
  t,
  youLabel,
}: {
  player: MatchPlayerView | null;
  t: Translate;
  youLabel: string | null;
}) {
  if (!player) {
    return (
      <div className="match-chip match-chip-empty">
        <span className="match-chip-name">{t("match.state.waiting")}</span>
      </div>
    );
  }

  return (
    <div
      className={`match-chip${player.isYou ? " is-you" : ""}${
        player.online || player.finished ? "" : " is-offline"
      }`}
    >
      <span className="match-chip-avatar" aria-hidden="true">
        {player.initial}
      </span>
      <span className="match-chip-body">
        <span className="match-chip-name">
          {player.name || t("room.players.anon")}
          {youLabel && <em className="match-chip-you">{youLabel}</em>}
        </span>
        <small className="match-chip-state">{stateOf(player, t)}</small>
      </span>
      <span className="match-chip-cards">
        {/* El contador se anuncia solo para tu rival: el tuyo ya lo ves en el
            mazo, y dos regiones vivas hablando a la vez se pisan. */}
        <strong aria-live={player.isYou ? "off" : "polite"}>
          {player.cardsLeft}
        </strong>
        <small>{t("match.cards")}</small>
      </span>
    </div>
  );
}
