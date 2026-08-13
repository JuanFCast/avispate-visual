"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cuánto hay que sostener el botón para que abandone de verdad.
 *
 * Probado en 5000 y era demasiado: la gente soltaba antes creyendo que no
 * funcionaba. A 2500 ya es imposible activarlo por accidente tapeando
 * rápido —que es el objetivo— y se siente que respondió.
 */
export const EXIT_HOLD_MS = 2500;

const RING_R = 13;
const RING_CIRC = 2 * Math.PI * RING_R;

/**
 * El botón de salir del tablero: un gesto sostenido, no un toque.
 *
 * En reposo pasa desapercibido a propósito (ícono chico, opacidad baja, sin
 * fondo). Mantenerlo presionado dibuja un anillo de progreso alrededor —
 * `stroke-dashoffset` animado con una `transition` lineal de exactamente
 * `EXIT_HOLD_MS`, así el CSS hace el conteo y no un `setInterval` que se
 * puede desincronizar del timeout real. Soltar antes de tiempo lo devuelve a
 * lleno en 200 ms: rápido, para que quede claro que se canceló.
 *
 * `pointerdown/up/cancel/leave` y no `click`: un `click` no distingue "lo
 * mantuve" de "lo toqué", y `pointerleave` cubre el dedo que se arrastra
 * fuera del botón sin soltar. `preventDefault` en `contextmenu` es
 * obligatorio en Android — sin él, el menú contextual aparece a los ~500 ms
 * y mata el gesto antes de completarlo.
 */
export default function ExitHold({
  onComplete,
  label,
}: {
  onComplete: () => void;
  label: string;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setHolding(false);
  }, [clearTimer]);

  const start = useCallback(() => {
    if (timerRef.current !== null) return; // ya sosteniendo, un segundo dedo no reinicia nada
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(40);
      setHolding(false);
      onComplete();
    }, EXIT_HOLD_MS);
  }, [onComplete]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <button
      type="button"
      className={`exit-hold${holding ? " is-holding" : ""}`}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 32 32" className="exit-hold-ring" aria-hidden="true">
        <circle cx="16" cy="16" r={RING_R} className="exit-hold-ring-track" />
        <circle
          cx="16"
          cy="16"
          r={RING_R}
          className="exit-hold-ring-fill"
          style={{
            strokeDasharray: RING_CIRC,
            strokeDashoffset: holding ? 0 : RING_CIRC,
            transitionDuration: `${holding ? EXIT_HOLD_MS : 200}ms`,
          }}
        />
      </svg>
      <span className="exit-hold-icon" aria-hidden="true">
        🚪
      </span>
    </button>
  );
}
