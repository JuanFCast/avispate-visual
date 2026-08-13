"use client";

import type { MatchPlayerView } from "@/lib/arena-match";
import { seatColor } from "@/lib/arena-seat-color";
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
 * Así que los jugadores se fueron a las esquinas, incluido TÚ. La posición de
 * cada silla es memoria muscular: no cambia con quién juegue, así que el
 * módulo de "tú" siempre cae abajo-derecha, mires la mesa que mires.
 */

/**
 * Quién va en qué esquina — fija, no según orden de llegada al array.
 *
 * Rival 1 arriba-izquierda, rival 2 arriba-derecha, rival 3 abajo-izquierda,
 * tú SIEMPRE abajo-derecha. Con menos de tres rivales las esquinas sobrantes
 * quedan vacías y las que sí tienen jugador no cambian de sitio: la mesa de
 * dos no es una mesa de cuatro con dos huecos repartidos distinto.
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
    baseLeft: rivals[0] ?? null,
    baseRight: rivals[1] ?? null,
    mineLeft: rivals[2] ?? null,
    mineRight: you,
  };
}

export function stateOf(player: MatchPlayerView, t: Translate): string {
  if (player.finished) return t("match.state.finished");
  if (player.left) return t("match.state.left");
  if (!player.online) return t("match.state.offline");
  return t("match.state.playing");
}

/**
 * Un jugador en la esquina: dos líneas y nada más.
 *
 * Línea 1: un punto del color de su silla —siempre el mismo, del primer
 * latido al último— y el alias, recortado con `…` por CSS (`flex:1 1 0` +
 * `min-width:0` en el contenedor, `text-overflow:ellipsis` en el texto) y
 * nunca por cuenta de caracteres, que rompe con nombres angostos o anchos
 * según la fuente. Línea 2: el mazo y cuántas cartas le quedan. El color
 * nunca es el único distintivo — el nombre sigue ahí para quien no lo
 * distingue.
 */
export function RailChip({ player }: { player: MatchPlayerView | null }) {
  const t = useT();

  if (!player) {
    return (
      <div className="corner-module corner-module-empty">
        <div className="corner-module-row">
          <small className="corner-module-name">{t("match.state.waiting")}</small>
        </div>
      </div>
    );
  }

  const name = player.name || t("room.players.anon");
  const state = stateOf(player, t);
  const out = player.finished || player.left;

  return (
    <div
      className={`corner-module${player.isYou ? " is-you" : ""}${
        !player.online && !out ? " is-offline" : ""
      }${out ? " is-out" : ""}`}
      style={{ "--seat-color": seatColor(player.seat) } as React.CSSProperties}
      title={`${name} · ${state}`}
    >
      <div className="corner-module-row">
        <span className="corner-module-dot" aria-hidden="true" />
        <span className="corner-module-name">{name}</span>
        {player.finished && (
          <em className="corner-module-flag" aria-hidden="true">
            🏁
          </em>
        )}
        {player.left && !player.finished && (
          <em className="corner-module-flag" aria-hidden="true">
            🚪
          </em>
        )}
      </div>
      <div className="corner-module-row">
        <span className="corner-module-deck" aria-hidden="true">
          🎴
        </span>
        {/* Solo se anuncia el del rival: el tuyo ya lo canta la píldora del mazo,
            y dos regiones vivas diciendo números a la vez se pisan. */}
        <span
          className="corner-module-count"
          aria-live={player.isYou ? "off" : "polite"}
          aria-label={`${name}: ${player.cardsLeft} ${t("match.cards")} · ${state}`}
        >
          {player.cardsLeft}
        </span>
      </div>
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
