"use client";

import { useT } from "@/lib/i18n/client";

interface Props {
  deckSize: number;
  cardsLeft: number;
  muted: boolean;
  onToggleMute: () => void;
}

/**
 * Franja superior durante la partida: ronda actual, barra de progreso y el
 * toggle de sonido. El resto de estadísticas vive a los lados del tablero.
 */
export default function GameHUD({
  deckSize,
  cardsLeft,
  muted,
  onToggleMute,
}: Props) {
  const t = useT();
  const spent = deckSize - cardsLeft;

  return (
    <div className="play-top">
      <div className="progress-wrap">
        <span className="progress-label">
          {t("game.hud.round", {
            current: Math.min(spent + 1, deckSize),
            total: deckSize,
          })}
        </span>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={deckSize}
          aria-valuenow={spent}
        >
          <div
            className="progress-fill"
            style={{ width: `${(spent / deckSize) * 100}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        className="mute-btn"
        onClick={onToggleMute}
        aria-label={muted ? t("sound.unmute") : t("sound.mute")}
      >
        {muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}
