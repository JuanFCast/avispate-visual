"use client";

import type { MatchPlayerView } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";

/**
 * Los jugadores durante la partida, en las cuatro esquinas del tablero.
 *
 * Antes esto era una franja horizontal encima del tablero. Funcionaba con un
 * rival y se caía con tres: cuatro chips completos en 375 px dejan 85 px por
 * cabeza —donde el alias no cabe— y, sobre todo, le robaban alto a lo único que
 * de verdad hay que mirar. En un juego que se gana viendo un símbolo entre
 * ocho, la carta es la pantalla; todo lo demás es borde.
 *
 * Así que los jugadores se fueron a las esquinas, incluido TÚ. No es simetría
 * porque sí: cualquier excepción para el propio jugador vuelve a meter una
 * banda en el centro, y la regla tiene que aguantar igual con 2, 3 y 4.
 *
 * Un círculo inscrito en su caja deja libre un triángulo en cada una de las
 * CUATRO esquinas de esa caja, y por simetría los cuatro miden lo mismo. Eso es
 * lo que hace posible anclar un chip a cada lado de BASE (sus dos esquinas de
 * arriba) y uno a cada lado de TU CARTA (sus dos esquinas de abajo) sin tocar
 * ningún círculo y sin repetir la cuenta de `verify-match-board-fit.ts`.
 */

/**
 * Quién va en qué esquina.
 *
 * Tú y el primer rival flanquean TU CARTA —es tu jugada, es donde miras—; el
 * segundo y el tercer rival flanquean BASE. Con menos de tres rivales las
 * esquinas de BASE simplemente se quedan vacías, así que la misma regla vale
 * para 2, 3 y 4 mesas sin ramificar el layout:
 *
 *   2 jugadores → mineLeft: tú, mineRight: r1
 *   3 jugadores → + baseLeft: r2
 *   4 jugadores → + baseRight: r3
 */
export function matchSlots(
  you: MatchPlayerView | null,
  rivals: MatchPlayerView[]
): {
  baseLeft: MatchPlayerView | null;
  baseRight: MatchPlayerView | null;
  mineLeft: MatchPlayerView | null;
  mineRight: MatchPlayerView | null;
} {
  return {
    mineLeft: you,
    mineRight: rivals[0] ?? null,
    baseLeft: rivals[1] ?? null,
    baseRight: rivals[2] ?? null,
  };
}

export function stateOf(player: MatchPlayerView, t: Translate): string {
  if (player.finished) return t("match.state.finished");
  if (player.left) return t("match.state.left");
  if (!player.online) return t("match.state.offline");
  return t("match.state.playing");
}

/**
 * Un jugador en la esquina: inicial, cartas que le quedan y su alias real.
 *
 * El número es lo más grande del chip porque es la carrera: es la única cifra
 * que se mira de reojo sin soltar la partida. El alias va debajo, recortado
 * con `…` solo cuando de verdad no cabe —nunca se sustituye por la inicial, ni
 * el tuyo por "TÚ": esa insignia va aparte, sobre el avatar, para no borrar tu
 * propio nombre de la mesa. El estado no se escribe, se pinta (apagado,
 * bandera, puerta), y viaja completo en el `title` y en el `aria-label` para
 * quien no puede verlo.
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
        {player.isYou && <em className="rail-chip-you">{t("match.you")}</em>}
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
      <span className="rail-chip-cards-label" aria-hidden="true">
        {t("match.cards")}
      </span>
      <small className="rail-chip-name">{name}</small>
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
