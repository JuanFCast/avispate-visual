// Verifica que el tablero de la Arena quepa entero en 100dvh y que las
// columnas de jugador dejen un diámetro de carta razonable, en los tamaños
// reales de pantalla del WebView de MiniPay.
//
// ── La vuelta atrás que explica este archivo ─────────────────────────────
//
// La versión anterior metía los chips en el triángulo muerto de la esquina
// de la carta para exprimir cada píxel de diámetro. Se veía horrible: el
// alias se recortaba a cuatro letras, la cuenta de cartas no cabía y el chip
// entero quedaba del tamaño de una uña. La referencia real pedía lo
// contrario — tarjetas legibles, con el alias completo y "N cartas" debajo —
// así que los jugadores volvieron a vivir en columnas de verdad a los lados
// del tablero, no superpuestas al círculo.
//
// Eso cambia lo que hay que comprobar. Ya no hace falta trigonometría: si el
// chip nunca entra en la caja de la carta, nunca la toca, punto. Lo que sí
// hay que vigilar es que la carta no se quede diminuta por culpa de las
// columnas, y que todo —tablero, columnas, pie— quepa en el alto real sin
// scroll.
//
// Correr: node scripts/verify-match-board-fit.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/* ── Los números, leídos del CSS ─────────────────────────────────────────── */

const css = readFileSync(join(ROOT, "app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** El bloque de `.shell.playing.match-shell` que declara la geometría. */
const bloque = (() => {
  const i = css.indexOf(".shell.playing.match-shell {");
  if (i === -1) throw new Error("no encuentro el bloque de geometría del tablero");
  return css.slice(i, css.indexOf("}", i));
})();

function px(nombre: string): number {
  const m = new RegExp(`--${nombre}:\\s*(-?[\\d.]+)px`).exec(bloque);
  if (!m) throw new Error(`falta --${nombre} en .shell.playing.match-shell`);
  return Number(m[1]);
}

/** `clamp(<mín>px, <k>vw, <máx>px)`, tal como lo escribe el CSS. */
function clampVw(nombre: string): (vw: number) => number {
  const m = new RegExp(
    `--${nombre}:\\s*clamp\\(\\s*([\\d.]+)px\\s*,\\s*([\\d.]+)vw\\s*,\\s*([\\d.]+)px\\s*\\)`
  ).exec(bloque);
  if (!m) throw new Error(`--${nombre} debería ser un clamp(px, vw, px)`);
  const [, min, k, max] = m.map(Number);
  return (vw) => Math.min(Math.max((vw * k) / 100, min), max);
}

const chipW = clampVw("chip-w");
const CHIP_GAP = px("chip-gap");

/** Los tres términos del `min()` del diámetro, tal como están escritos. */
const formula = /--card-d:\s*min\(([\s\S]*?)\);/.exec(bloque)?.[1] ?? "";
const TOPE = Number(/(\d+)px\s*$/.exec(formula.trim())?.[1] ?? 0);
const ALTO_RESTA = Number(/50dvh\s*-\s*(\d+)px/.exec(formula)?.[1] ?? 0);

console.log(`\nColchón por columna: gap ${CHIP_GAP}px, tope de carta ${TOPE}px\n`);

ok(
  "la fórmula del diámetro sigue restando las dos columnas y el alto",
  TOPE > 0 && ALTO_RESTA > 0 && /100vw/.test(formula) && /chip-w/.test(formula),
  formula.replace(/\s+/g, " ").trim()
);

/** Diámetro de carta que resultaría en esta pantalla. */
function diametro(vw: number, vh: number): number {
  const ancho = vw - 32 - 2 * chipW(vw) - 2 * CHIP_GAP;
  const alto = vh / 2 - ALTO_RESTA;
  return Math.min(ancho, alto, TOPE);
}

/**
 * Pantallas reales, ya descontado el cromo de MiniPay.
 *
 * El alto NO es el de la pantalla: el WebView pierde arriba la barra del Mini
 * App (la de "Mini App Test" con la X y el desplegable) y abajo la de gestos.
 * En la captura del iPhone del 2026-08-08 el alto útil medido era ~745 CSS px
 * sobre una pantalla de 852, y de ahí salen las demás restas.
 */
const PANTALLAS: [string, number, number][] = [
  ["iPhone 15 Pro · MiniPay", 393, 745],
  ["iPhone 15 Pro Max · MiniPay", 430, 825],
  ["iPhone SE · MiniPay", 375, 560],
  ["Android típico · MiniPay", 360, 705],
  ["Android pequeño · MiniPay", 360, 545],
  ["Pixel · MiniPay", 412, 720],
  ["Muy estrecho", 320, 480],
  ["Estrecho y muy alto", 320, 900],
];

/** Por debajo de esto el círculo deja de sentirse "grande" en la pantalla. */
const DIAMETRO_MIN = 150;

console.log("— El diámetro de carta que deja cada pantalla —\n");
console.log("  pantalla                       columna  carta");

for (const [nombre, vw, vh] of PANTALLAS) {
  const d = diametro(vw, vh);
  console.log(
    `  ${nombre.padEnd(30)} ${String(Math.round(chipW(vw))).padStart(5)}px  ${String(
      Math.round(d)
    ).padStart(4)}px`
  );
  ok(
    `    ${nombre}: la carta no se queda diminuta`,
    d >= DIAMETRO_MIN,
    `${d.toFixed(1)}px de diámetro (mínimo ${DIAMETRO_MIN})`
  );
}

/* ── Un jugador por esquina, y los indicadores dentro de su columna ──────── */

console.log("\n— Cuatro puestos de jugador y dos indicadores, ni uno más ─\n");

{
  const src = readFileSync(join(ROOT, "components/arena/ArenaMatch.tsx"), "utf8");

  /** El trozo del código entre dos marcas literales, o `null` si no las encuentra. */
  function entre(desde: string, hasta: string): string | null {
    const i = src.indexOf(desde);
    if (i === -1) return null;
    const j = src.indexOf(hasta, i + desde.length);
    if (j === -1) return null;
    return src.slice(i + desde.length, j);
  }

  const board = entre('<div className="play-board match-board">', "\n      {/* Lo que no es partida");
  ok("encuentro el cuerpo de .match-board", board !== null, "cambió el marcado del tablero");

  for (const esquina of [
    "corner-base-left",
    "corner-base-right",
    "corner-mine-left",
    "corner-mine-right",
  ]) {
    const veces = [...(board ?? "").matchAll(new RegExp(`className="corner ${esquina}"`, "g"))]
      .length;
    ok(`    hay exactamente una esquina "${esquina}"`, veces === 1, `${veces}`);
  }

  const pastillas = [...(board ?? "").matchAll(/className="stat-pill"/g)].length;
  ok(
    "    hay exactamente dos indicadores (Tiempo y Castigos), dentro de las columnas",
    pastillas === 2,
    `${pastillas} pastillas`
  );

  ok(
    "el botón de silencio no vive en el tablero",
    !/mute-btn/.test(board ?? ""),
    "el silencio se metió otra vez en una columna en vez de en el pie"
  );

  ok(
    "y la cifra de cartas no se repite: ya la lleva tu ficha",
    !/sp-emoji">🃏/.test(src),
    "la píldora CARTAS dice el mismo número que el chip del jugador"
  );
}

/* ── El presupuesto vertical alcanza para todo, no solo para la carta ────── */

console.log("\n— La pantalla entera cabe en 100dvh, sin scroll —\n");

{
  /*
   * Las columnas de jugador ya no cuestan alto de flujo —son tan altas como
   * el tablero, `align-items: stretch` se encarga— así que lo único que hay
   * que sumar aparte del tablero es el pie (silencio + abandonar).
   */
  const SHELL_PAD_V = 32; // .shell { padding: 16px } arriba + abajo
  const SHELL_GAP = 10; // .match-shell { gap: 10px }, un solo hueco: tablero → pie
  const FOOT_H = 42; // .match-foot .mute-btn 40px + margin-top 2px
  const CARD_GAP = 32; // .shell.playing.match-shell .chain-area { --card-gap: 32px }

  for (const [nombre, vw, vh] of PANTALLAS) {
    const d = diametro(vw, vh);
    const usado = SHELL_PAD_V + SHELL_GAP + FOOT_H + 2 * d + CARD_GAP;
    ok(
      `    ${nombre}: tablero + pie caben en el alto disponible`,
      usado <= vh,
      `usa ${Math.round(usado)}px de ${vh}px — se pasa por ${Math.round(usado - vh)}px`
    );
  }
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
