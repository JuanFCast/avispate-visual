"use client";

import { PLAY_STAGE_KEY, type PlayStage } from "@/lib/pay";
import { useT } from "@/lib/i18n/client";

interface Props {
  /** Texto en reposo; mientras se procesa manda el paso. */
  label: string;
  /** Paso del flujo de jugada, o `null` si no hay nada en curso. */
  stage: PlayStage | null;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

/**
 * Botón de jugar: el mismo del lobby y de los resultados. Mientras la jugada
 * se procesa no se cambia de pantalla — el botón se desactiva, gira un
 * spinner y el texto va contando el paso (cadena, firma, allowance, registro).
 */
export default function PlayButton({
  label,
  stage,
  disabled,
  className,
  onClick,
}: Props) {
  const t = useT();
  const busy = stage !== null;
  return (
    <button
      type="button"
      className={`btn-primary${className ? ` ${className}` : ""}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-live="polite"
      onClick={onClick}
    >
      {busy && <span className="btn-spinner" aria-hidden="true" />}
      {busy ? t(PLAY_STAGE_KEY[stage]) : label}
    </button>
  );
}
