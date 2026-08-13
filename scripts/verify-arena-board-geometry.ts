// Verifica la geometría del tablero de la Arena: el diámetro de carta manda
// sobre todo, los jugadores no le restan ni un píxel, y ni las esquinas ni
// la cintura (Tomadas/Castigos/salir) pisan el círculo.
//
// Correr: node scripts/verify-arena-board-geometry.ts
import {
  boardDiameter,
  cornerFits,
  cornerMaxWidth,
  waistOffset,
  waistRoom,
} from "../lib/arena-board-geometry.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/* ── Las constantes reales, las mismas que `globals.css` y `ArenaMatch.tsx` ── */

const SHELL_PAD = 4; // padding mínimo del shell (4px, o el área segura si es mayor)
const CIRCLE_GAP = 4; // separación entre BASE y TU CARTA — casi tangentes
const CORNER_H = 40;
const CORNER_BLEED = 16;
const CORNER_MIN_W = 56;
const CORNER_MAX_W = 100;
const WAIST_H = 32;
const AIR_MIN = 4;

function diametro(vw: number, vhUtil: number): number {
  return boardDiameter(vw - 2 * SHELL_PAD, vhUtil - 2 * SHELL_PAD, CIRCLE_GAP);
}

/**
 * Los cuatro viewports de aceptación (los tres que ya usa el proyecto, más
 * el de la captura de referencia, estimada) y los rangos de diámetro que se
 * acordaron con esos números.
 */
const VIEWPORTS: [string, number, number, [number, number] | null][] = [
  ["iPhone SE · MiniPay", 375, 560, [270, 282]],
  ["iPhone 15 Pro · MiniPay", 393, 745, null], // manda el ancho: sin rango fijo
  ["Android pequeño · MiniPay", 360, 545, [263, 275]],
  ["Captura de referencia (~375×611)", 375, 611, [297, 309]],
];

console.log(
  `\nSHELL_PAD=${SHELL_PAD}px  CIRCLE_GAP=${CIRCLE_GAP}px  CORNER_BLEED=${CORNER_BLEED}px\n`
);
console.log("— El diámetro manda sobre todo —\n");
console.log("  viewport                          D       manda   D/ancho");

const resultados: { nombre: string; d: number; r: number }[] = [];

for (const [nombre, vw, vh, rango] of VIEWPORTS) {
  const d = diametro(vw, vh);
  const r = d / 2;
  resultados.push({ nombre, d, r });
  const widthTerm = vw - 2 * SHELL_PAD;
  const manda = widthTerm <= (vh - 2 * SHELL_PAD - CIRCLE_GAP) / 2 ? "ancho" : "alto";
  console.log(
    `  ${nombre.padEnd(32)} ${d.toFixed(1).padStart(6)}px  ${manda.padStart(5)}   ${(
      (d / vw) *
      100
    ).toFixed(0)}%`
  );
  if (rango) {
    ok(
      `    ${nombre}: D en el rango acordado (${rango[0]}-${rango[1]})`,
      d >= rango[0] - 1 && d <= rango[1] + 1,
      `D=${d.toFixed(1)}`
    );
  }
  ok(`    ${nombre}: la carta no queda diminuta`, d >= 200, `D=${d.toFixed(1)}`);
}

console.log("\n— Las cuatro esquinas no pisan el círculo —\n");

for (const { nombre, r } of resultados) {
  const w = cornerMaxWidth(r, CORNER_H, CORNER_BLEED, CORNER_MIN_W, CORNER_MAX_W, AIR_MIN);
  const { fits, airPx } = cornerFits(r, w, CORNER_H, CORNER_BLEED);
  console.log(`  ${nombre.padEnd(32)} corner=${w.toFixed(1)}px  aire=${airPx.toFixed(1)}px`);
  ok(`    ${nombre}: el módulo de esquina no pisa el círculo`, fits, `aire ${airPx.toFixed(1)}px`);
}

console.log("\n— La cintura (Tomadas/Castigos/salir) no pisa el círculo —\n");

for (const { nombre, r } of resultados) {
  const off = waistOffset(r, WAIST_H, AIR_MIN);
  const room = waistRoom(r, WAIST_H, AIR_MIN);
  console.log(
    `  ${nombre.padEnd(32)} offset=${off.toFixed(1)}px  room=${room.toFixed(1)}px`
  );
  ok(
    `    ${nombre}: queda ancho de sobra para una píldora chica (>=40px)`,
    room >= 40,
    `solo ${room.toFixed(1)}px libres desde el offset seguro`
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
