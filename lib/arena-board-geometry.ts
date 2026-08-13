/**
 * La geometría del tablero de la Arena, en números y no de oído.
 *
 * Función pura, sin DOM: recibe el tamaño del escenario y devuelve el
 * diámetro de las dos cartas y cuánto puede medir un módulo sin tocar el
 * círculo. `scripts/verify-arena-board-geometry.ts` la recorre con los
 * viewports de aceptación sin levantar un navegador.
 *
 * `boardDiameter` es la misma cuenta que hace `--card-d` en CSS —
 * `min(ancho, (alto - gap) / 2)` — repetida acá SOLO para que JS pueda
 * derivar el ancho seguro de los overlays (esquina, cintura) a partir del
 * mismo número. El diámetro REAL de la carta lo decide CSS, no esta
 * función: un `calc()` de hoja de estilos no depende de que un
 * `ResizeObserver` dispare a tiempo, así que no hay manera de que la carta
 * se quede pegada a un valor de arranque chico si la medición en JS falla o
 * llega tarde. Ver `lib/use-viewport-size.ts`.
 */

/** `D = min(ancho, (alto − gap) / 2)`. Igual con 2, 3 o 4 jugadores. */
export function boardDiameter(width: number, height: number, gap: number): number {
  return Math.min(width, (height - gap) / 2);
}

/**
 * Cuánto puede medir de ANCHO un módulo de esquina de alto fijo `moduleH`,
 * apoyado en la esquina de la caja del círculo, sin pisarlo — ni siquiera
 * usando todo el `bleedBudget` disponible (lo que puede robarle al padding
 * del shell, saliendo hacia el borde de la pantalla).
 *
 * `(r − w + bleed)² + (r − h + bleed)² ≥ (r + airMin)²`: se despeja `w` para
 * el `bleed` máximo, apuntando a `airMin` de aire real y no a la igualdad
 * justa (que se leería igual de mal que pisarlo). Si ni agotando el
 * presupuesto entra nada legible, devuelve `minW` de todos modos —hay que
 * dibujar algo— y `cornerFits` es quien puede detectar que ese `minW` sigue
 * violando el círculo.
 */
export function cornerMaxWidth(
  r: number,
  moduleH: number,
  bleedBudget: number,
  minW: number,
  maxW: number,
  airMin = 4
): number {
  const rTarget = r + airMin;
  const dy = r - moduleH + bleedBudget;
  const k = rTarget * rTarget - dy * dy;
  if (k < 0) return maxW;
  const w = r + bleedBudget - Math.sqrt(k);
  return Math.min(maxW, Math.max(minW, w));
}

/** ¿De verdad cabe, con las medidas ya decididas? */
export function cornerFits(
  r: number,
  moduleW: number,
  moduleH: number,
  bleedBudget: number
): { fits: boolean; airPx: number } {
  const dx = r - moduleW + bleedBudget;
  const dy = r - moduleH + bleedBudget;
  const dist = Math.hypot(dx, dy);
  return { fits: dist >= r, airPx: dist - r };
}

/**
 * La cintura: el hueco que deja la curvatura justo donde las dos cartas casi
 * se tocan. Un módulo centrado en ese punto, de alto `moduleH`, se mete
 * `moduleH / 2` hacia ARRIBA en el círculo de abajo de BASE y otro tanto
 * hacia ABAJO en el de arriba de TU CARTA — por simetría, la misma cuenta
 * vale para los dos. Esta función devuelve a qué distancia del eje central
 * tiene que arrancar el borde interior del módulo para no pisar ninguno de
 * los dos círculos.
 *
 * Es la MISMA desigualdad que la esquina, but rotada: en vez de "esquina de
 * la caja", el punto de apoyo es "mitad del borde de la caja" (donde el
 * círculo es tangente), así que solo hay que alejarse en X — no hace falta
 * bleed porque el hueco lateral es GENUINO, no una esquina compartida con
 * otro círculo.
 */
export function waistOffset(r: number, moduleH: number, airMin = 4): number {
  const hUp = moduleH / 2 + airMin;
  const k = hUp * (2 * r - hUp);
  return k <= 0 ? 0 : Math.sqrt(k);
}

/** Cuánto ancho le queda a un módulo de cintura desde `waistOffset` hasta el borde de la caja. */
export function waistRoom(r: number, moduleH: number, airMin = 4): number {
  return Math.max(0, r - waistOffset(r, moduleH, airMin));
}
