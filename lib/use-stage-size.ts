"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface StageSize {
  width: number;
  height: number;
}

/**
 * El ancho/alto REAL del contenedor de juego, medido en vivo.
 *
 * `100dvh` es una promesa de la especificación CSS, y dentro de un WebView
 * embebido (MiniPay, o cualquier Mini App host) esa promesa no siempre se
 * cumple igual: el host puede cambiar su propio chrome sin que el motor de
 * layout del WebView lo notifique a tiempo, o puede reportar un valor que
 * no coincide con lo que el usuario ve de verdad. Medir el contenedor con
 * `ResizeObserver` — y escuchar también `visualViewport`, que a veces avisa
 * de cambios que el observer del elemento no ve por su cuenta— da el número
 * real en vez de una unidad que promete serlo.
 */
export function useStageSize<T extends HTMLElement>(): [RefObject<T | null>, StageSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<StageSize>({ width: 0, height: 0 });

  // `useLayoutEffect`, no `useEffect`: mide ANTES de que el navegador pinte
  // el primer cuadro, así el tablero no aparece un instante a tamaño 0.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      vv?.removeEventListener("resize", measure);
    };
  }, []);

  return [ref, size];
}
