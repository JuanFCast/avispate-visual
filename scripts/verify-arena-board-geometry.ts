// Verifica la geometría nueva del tablero de la Arena: el diámetro de carta,
// que los módulos de esquina no toquen el círculo, y que el intersticio
// alcance para los módulos de Tomadas/Castigos — en los cuatro viewports de
// aceptación y en el diámetro mínimo/máximo posible.
//
// Correr: node scripts/verify-arena-board-geometry.ts
import {
  boardDiameter,
  cornerFits,
  cornerMaxWidth,
  gapFits,
} from "../lib/arena-board-geometry.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/* ── Las constantes reales, las mismas que usa el CSS/JS ─────────────────── */

const GAP = 68; // separación entre BASE y TU CARTA — aloja los módulos del intersticio
const BLEED = 16; // lo que un módulo de esquina puede robarle al padding del shell
const CORNER_H = 40;
const CORNER_MIN_W = 60;
const CORNER_MAX_W = 86; // el ancho que pide el spec
const GAP_MODULE_H = 52;
const GAP_MODULE_MARGIN = 8;
const AIRE_MIN = 4; // separación mínima para no considerarlo "al ras"

/**
 * Los cuatro viewports de aceptación, tal como los pidió el spec — CSS px
 * reales, sin restarles cromo a mano: son el número que da
 * `useStageSize` ya medido, no una promesa de `dvh`.
 */
const VIEWPORTS: [string, number, number][] = [
  ["320×568 (el más chico)", 320, 568],
  ["375×667", 375, 667],
  ["393×852", 393, 852],
  ["412×915 (el más alto)", 412, 915],
];

console.log(`\nGAP=${GAP}px  BLEED=${BLEED}px  módulo esquina ${CORNER_MIN_W}-${CORNER_MAX_W}×${CORNER_H}px\n`);

console.log("— Diámetro de carta, igual sea cual sea el ancho o el alto que mande —\n");
console.log("  viewport                  d       r     manda");

const resultados: { nombre: string; d: number; r: number }[] = [];

for (const [nombre, w, h] of VIEWPORTS) {
  const d = boardDiameter(w, h, GAP);
  const r = d / 2;
  resultados.push({ nombre, d, r });
  const mandaElAncho = w <= (h - GAP) / 2;
  console.log(
    `  ${nombre.padEnd(26)} ${d.toFixed(1).padStart(6)}  ${r.toFixed(1).padStart(5)}  ${
      mandaElAncho ? "ancho" : "alto"
    }`
  );
  ok(`    ${nombre}: d = min(W, (H-G)/2)`, d === Math.min(w, (h - GAP) / 2), `d=${d}`);
  ok(`    ${nombre}: la carta no queda diminuta`, d >= 200, `d=${d.toFixed(1)}`);
}

console.log("\n— Los módulos de esquina no tocan el círculo —\n");
console.log("  viewport                  ancho seguro   aire");

for (const { nombre, r } of resultados) {
  const w = cornerMaxWidth(r, CORNER_H, BLEED, CORNER_MIN_W, CORNER_MAX_W);
  const { fits, airPx } = cornerFits(r, w, CORNER_H, BLEED);
  console.log(
    `  ${nombre.padEnd(26)} ${w.toFixed(1).padStart(10)}px  ${airPx.toFixed(1).padStart(6)}px`
  );
  ok(
    `    ${nombre}: el módulo de esquina (${w.toFixed(1)}px) no pisa el círculo`,
    fits && airPx >= AIRE_MIN - 0.05,
    `aire ${airPx.toFixed(1)}px (mínimo ${AIRE_MIN}) — r=${r.toFixed(1)}, bleed=${BLEED}`
  );
  // Informativo, no cuenta como falla: en un círculo chico el ancho SEGURO
  // es menor que los 86px del spec a propósito — `cornerMaxWidth` recorta
  // antes de arriesgar el pisado. Se deja a la vista para reportarlo, no
  // para tratarlo como un bug.
  if (w < CORNER_MAX_W - 0.1) {
    console.log(
      `         (nota: ${w.toFixed(1)}px, no los ${CORNER_MAX_W}px del spec — el círculo es chico para el módulo completo)`
    );
  }
}

console.log("\n— El intersticio alcanza para Tomadas/Castigos —\n");

ok(
  `GAP=${GAP}px aloja un módulo de ${GAP_MODULE_H}px con ${GAP_MODULE_MARGIN}px de margen arriba y abajo`,
  gapFits(GAP, GAP_MODULE_H, GAP_MODULE_MARGIN),
  `hacen falta ${GAP_MODULE_H + 2 * GAP_MODULE_MARGIN}px, hay ${GAP}px`
);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
