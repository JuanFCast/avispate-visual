"use client";

import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

function read(): ViewportSize {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

/**
 * El tamaño del viewport, para derivar el ancho seguro de los overlays
 * (esquina, cintura) — NO para decidir el diámetro de la carta, que es
 * `--card-d` en CSS y no depende de este hook para nada.
 *
 * A propósito NO usa `ResizeObserver` sobre un elemento medido: eso depende
 * de que el observer dispare a tiempo y de que el elemento ya tenga su
 * tamaño final cuando dispara, y dentro de un WebView embebido (MiniPay)
 * esa doble condición puede fallar en silencio — el síntoma es quedarse
 * pegado al valor de arranque para siempre. `window.innerWidth` /
 * `visualViewport` están disponibles YA, en el primer render, sin esperar a
 * que nada se estabilice, así que no hay un valor de arranque incorrecto
 * que pueda persistir.
 */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(read);

  useEffect(() => {
    const update = () => setSize(read());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return size;
}
