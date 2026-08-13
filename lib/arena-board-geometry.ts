/**
 * La geometría del tablero de la Arena, en números y no de oído.
 *
 * Función pura, sin DOM: recibe el tamaño real del escenario (medido con
 * `useStageSize`, no supuesto de `dvh`) y devuelve el diámetro de las dos
 * cartas y cuánto puede medir un módulo de esquina sin tocar el círculo.
 * `scripts/verify-arena-board-geometry.ts` la recorre con los cuatro
 * viewports de aceptación sin levantar un navegador.
 */

/** `d = min(W, (H − gap) / 2)`. Igual con 2, 3 o 4 jugadores: no depende de cuántos haya. */
export function boardDiameter(width: number, height: number, gap: number): number {
  return Math.min(width, (height - gap) / 2);
}

/**
 * Cuánto puede medir de ANCHO un módulo de esquina de alto fijo `moduleH`,
 * sin que su esquina interna entre en el círculo — ni siquiera usando todo
 * el `bleedBudget` disponible (el margen que el módulo puede robarle al
 * padding exterior del shell, bleeding hacia el borde de la pantalla).
 *
 * La desigualdad real es `(r − w + bleed)² + (r − h + bleed)² ≥ r²`: el
 * módulo se apoya en la esquina de la caja del círculo, `bleed` lo empuja
 * hacia afuera en las dos direcciones a la vez, y lo que queda adentro
 * (`w − bleed`, `h − bleed`) es lo que de verdad hay que mantener fuera del
 * radio. Se despeja `w` para el `bleed` máximo disponible, y se recorta al
 * rango `[minW, maxW]` que sigue siendo legible.
 *
 * Si el círculo es tan chico que ni agotando el `bleedBudget` cabe nada
 * legible, devuelve `minW` de todos modos —hay que dibujar algo— y quien
 * llama es responsable de comprobar `cornerFits` aparte y avisar si no
 * alcanza: esta función no miente diciendo que sí cupo.
 */
export function cornerMaxWidth(
  r: number,
  moduleH: number,
  bleedBudget: number,
  minW: number,
  maxW: number,
  /**
   * Separación mínima real, no solo "no tocar". En el límite exacto
   * (`airMin = 0`) el módulo roza el círculo al milímetro, y eso se lee
   * igual de mal que pisarlo un poco — por eso se apunta a este aire de
   * sobra y no a la igualdad justa.
   */
  airMin = 4
): number {
  // Se resuelve para un radio "inflado" en `airMin`: pedirle al módulo que
  // quede fuera de un círculo un poco más grande dejfa, contra el círculo de
  // verdad, exactamente `airMin` de aire.
  const rTarget = r + airMin;
  const k =
    rTarget * rTarget - (r - moduleH + bleedBudget) * (r - moduleH + bleedBudget);
  // k < 0: la altura sola ya deja el módulo fuera del círculo cualquiera sea
  // el ancho — no hay restricción real, así que se abre hasta `maxW`.
  if (k < 0) return maxW;
  const w = r + bleedBudget - Math.sqrt(k);
  return Math.min(maxW, Math.max(minW, w));
}

/**
 * ¿De verdad cabe? Repite la misma desigualdad con las medidas ya
 * decididas (después de aplicar `cornerMaxWidth` y sus topes), porque
 * recortar al `minW` puede haber dejado el módulo violando el círculo de
 * todos modos en un círculo muy chico — y eso hay que poder detectarlo, no
 * asumir que `cornerMaxWidth` ya lo evitó.
 */
export function cornerFits(
  r: number,
  moduleW: number,
  moduleH: number,
  bleedBudget: number
): { fits: boolean; airPx: number } {
  const dx = r - moduleW + bleedBudget;
  const dy = r - moduleH + bleedBudget;
  const distToCenter = Math.hypot(dx, dy);
  return { fits: distToCenter >= r, airPx: distToCenter - r };
}

/**
 * El intersticio entre BASE y TU CARTA cabe siempre que sea más alto que
 * los módulos que va a alojar: a diferencia de la esquina, ahí NO hace
 * falta trigonometría — ninguna de las dos cartas llega nunca a esa franja,
 * mida lo que mida `gap`. Solo hay que reservarle alto de sobra al `gap` de
 * `boardDiameter` para que el módulo (con su margen) quepa entero.
 */
export function gapFits(gap: number, moduleH: number, margin: number): boolean {
  return gap >= moduleH + margin * 2;
}
