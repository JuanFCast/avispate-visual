"use client";

import type { MatchPlayerView } from "@/lib/arena-match";
import { seatColor } from "@/lib/arena-seat-color";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";

/**
 * Los jugadores durante la partida, en las cuatro esquinas curvas del
 * tablero — overlays sobre el hueco muerto que deja el círculo en la caja,
 * nunca layout: no reservan ancho ni alto, y el diámetro de la carta no
 * sabe que existen. Ver `lib/arena-board-geometry.ts` para la cuenta.
 */

/**
 * Quién va en qué esquina — posición FIJA por asiento, no por cuántos haya
 * en la mesa. Tú siempre abajo-derecha; los rivales llenan arriba-izq,
 * arriba-der, abajo-izq en ese orden. Con menos de tres rivales las esquinas
 * sobrantes se quedan vacías — no se recentra ni se redistribuye nada:
 *
 *   2 jugadores → baseLeft: rival, mineRight: tú
 *   3 jugadores → + baseRight: rival
 *   4 jugadores → + mineLeft: rival
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
 * Un jugador en la esquina: dos líneas, nada más. Punto de color + alias
 * arriba, mazo + cuántas cartas le quedan abajo. `min-width: 0` en la fila y
 * `flex: 1 1 0` en el nombre son los que de verdad recortan con `…` — sin
 * `min-width: 0` un flex item nunca baja de su contenido y el módulo se
 * desborda en vez de truncar, sea cual sea el ancho del nombre.
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
 * que quitarle sitio.
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
