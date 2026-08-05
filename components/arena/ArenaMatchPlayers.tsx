"use client";

import type { MatchPlayerView } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";

/**
 * Los jugadores durante la partida, en los rieles laterales.
 *
 * Antes esto era una franja horizontal encima del tablero. Funcionaba con un
 * rival y se caía con tres: cuatro chips completos en 375 px dejan 85 px por
 * cabeza —donde el alias no cabe— y, sobre todo, le robaban alto a lo único que
 * de verdad hay que mirar. En un juego que se gana viendo un símbolo entre
 * ocho, la carta es la pantalla; todo lo demás es borde.
 *
 * Así que los jugadores se fueron a los laterales, incluido TÚ. No es simetría
 * porque sí: cualquier excepción para el propio jugador vuelve a meter una
 * banda en el centro, y la regla tiene que aguantar igual con 2, 3 y 4.
 *
 * Dónde caen exactamente lo decide el CSS con `space-between` sobre un riel tan
 * alto como el tablero: el primer chip queda en la esquina de arriba, el
 * segundo justo en la costura entre las dos cartas, y los indicadores abajo.
 * Los tres sitios son hueco muerto —las cartas son círculos y no llegan a las
 * esquinas—, así que nada de esto le quita un píxel a la carta.
 */

/**
 * Quién va en qué riel.
 *
 * Tú encabezas siempre el izquierdo, para que tu chip esté donde tu pulgar no
 * lo tapa y siempre en el mismo sitio partida tras partida. Los rivales se
 * reparten alternando y empezando por la derecha, que es lo que mantiene los
 * dos lados parejos en las cuatro mesas posibles:
 *
 *   2 jugadores → tú | r1
 *   3 jugadores → tú, r2 | r1
 *   4 jugadores → tú, r2 | r1, r3
 */
export function railsOf(
  you: MatchPlayerView | null,
  rivals: MatchPlayerView[]
): { left: MatchPlayerView[]; right: MatchPlayerView[] } {
  const left = you ? [you] : [];
  const right: MatchPlayerView[] = [];
  rivals.forEach((r, i) => (i % 2 === 0 ? right : left).push(r));
  return { left, right };
}

export function stateOf(player: MatchPlayerView, t: Translate): string {
  if (player.finished) return t("match.state.finished");
  if (player.left) return t("match.state.left");
  if (!player.online) return t("match.state.offline");
  return t("match.state.playing");
}

/**
 * Un jugador en el riel: inicial, cartas que le quedan y su nombre en pequeño.
 *
 * El número es lo más grande del chip porque es la carrera: es la única cifra
 * que se mira de reojo sin soltar la partida. El nombre va debajo y recortado
 * —a 52 px caben unas siete letras— y no por descuido: sirve para saber cuál de
 * los tres rivales va ganando, no para leerlo entero. El estado no se escribe,
 * se pinta (apagado, bandera, puerta), y viaja completo en el `title` y en el
 * `aria-label` para quien no puede verlo.
 */
export function RailChip({ player }: { player: MatchPlayerView | null }) {
  const t = useT();

  if (!player) {
    return (
      <div className="rail-chip rail-chip-empty">
        <span className="rail-chip-avatar" aria-hidden="true">
          ?
        </span>
        <small className="rail-chip-name">{t("match.state.waiting")}</small>
      </div>
    );
  }

  const name = player.name || t("room.players.anon");
  const state = stateOf(player, t);
  const out = player.finished || player.left;

  return (
    <div
      className={`rail-chip${player.isYou ? " is-you" : ""}${
        !player.online && !out ? " is-offline" : ""
      }${out ? " is-out" : ""}`}
      title={`${name} · ${state}`}
    >
      <span className="rail-chip-avatar" aria-hidden="true">
        {player.initial}
        {player.finished && <em className="rail-chip-flag">🏁</em>}
        {player.left && !player.finished && <em className="rail-chip-flag">🚪</em>}
      </span>
      {/* Solo se anuncia el del rival: el tuyo ya lo canta la píldora del mazo,
          y dos regiones vivas diciendo números a la vez se pisan. */}
      <strong
        className="rail-chip-cards"
        aria-live={player.isYou ? "off" : "polite"}
        aria-label={`${name}: ${player.cardsLeft} ${t("match.cards")} · ${state}`}
      >
        {player.cardsLeft}
      </strong>
      <small className="rail-chip-name">
        {player.isYou ? t("match.you") : name}
      </small>
    </div>
  );
}

/**
 * La cuenta regresiva sí puede enseñarlos en fila: todavía no hay tablero al
 * que quitarle sitio, y es el único momento en que mirar contra quién juegas
 * importa más que mirar una carta.
 */
export default function ArenaMatchPlayers({
  you,
  rivals,
}: {
  you: MatchPlayerView | null;
  rivals: MatchPlayerView[];
}) {
  const all = you ? [you, ...rivals] : rivals;

  return (
    <div className="match-countdown-players">
      {all.length === 0 ? (
        <RailChip player={null} />
      ) : (
        all.map((p) => <RailChip key={p.profileId} player={p} />)
      )}
    </div>
  );
}
