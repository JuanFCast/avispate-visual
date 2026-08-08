// Verifica que los indicadores del tablero NO toquen las cartas, en los
// tamaños reales de pantalla del WebView de MiniPay.
//
// ── El fallo ────────────────────────────────────────────────────────────────
//
// Los rieles se superponen al tablero a propósito: la carta es un círculo, y
// eso deja libres las cuatro esquinas de su caja, que es donde van los
// indicadores. La carta puede así ocupar el ancho entero de la pantalla.
//
// Lo que no se hizo nunca fue la cuenta. El hueco de una esquina es un
// triángulo cuyo lado mide unos `0,146 · d`: sobre una carta de 290 px son 42,
// y las pastillas medían 52 y venían apiladas de dos en dos, así que la de
// arriba llegaba hasta la mitad del círculo — que es justo donde más ancho es.
// En la captura del 2026-08-08, CARTAS cruzaba el borde cian de TU CARTA.
//
// ── Qué comprueba esto ─────────────────────────────────────────────────────
//
// La geometría, con trigonometría y no de oído. Lee del CSS los números de
// verdad —el ancho del riel, cuánto se sale, el alto de cada indicador, la
// sangría del tablero y la fórmula del diámetro— y para cada pantalla calcula
// a qué distancia queda la esquina del indicador del borde del círculo.
//
// Si alguien ensancha una pastilla, le sube el alto o cambia la cuenta del
// diámetro, aquí sale el número exacto de píxeles que se está comiendo.
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

/**
 * Una medida que encoge con la carta:
 * `clamp(<mín>px, calc(var(--card-d) * <k>), <máx>px)`.
 *
 * Se lee del CSS en vez de repetir los números aquí. Si mañana alguien sube el
 * factor o el tope, esta comprobación usa los suyos y no los de ayer.
 */
function escalada(nombre: string): (d: number) => number {
  const m = new RegExp(
    `--${nombre}:\\s*clamp\\(\\s*([\\d.]+)px\\s*,\\s*calc\\(var\\(--card-d\\)\\s*\\*\\s*([\\d.]+)\\)\\s*,\\s*([\\d.]+)px\\s*\\)`
  ).exec(bloque);
  if (!m) throw new Error(`--${nombre} debería escalar con la carta`);
  const [, min, k, max] = m.map(Number);
  return (d) => Math.min(Math.max(d * k, min), max);
}

const RAIL_OUT = px("rail-out");
const BLEED = px("board-bleed");
const railW = escalada("rail-w");
const chipH = escalada("rail-chip-h");
const pillH = escalada("rail-pill-h");

/** Los tres términos del `min()` del diámetro, tal como están escritos. */
const formula = /--card-d:\s*min\(([\s\S]*?)\);/.exec(bloque)?.[1] ?? "";
const TOPE = Number(/(\d+)px\s*$/.exec(formula.trim())?.[1] ?? 0);
const ALTO_RESTA = Number(/50dvh\s*-\s*(\d+)px/.exec(formula)?.[1] ?? 0);

console.log(
  `\nReserva por riel ${RAIL_OUT}px, sangría ${BLEED}px, tope de carta ${TOPE}px\n`
);

ok(
  "la fórmula del diámetro sigue teniendo sus tres términos",
  TOPE > 0 && ALTO_RESTA > 0 && /100vw/.test(formula),
  formula.replace(/\s+/g, " ").trim()
);

/* ── La geometría ────────────────────────────────────────────────────────── */

/** Diámetro de carta que resultaría en esta pantalla. */
function diametro(vw: number, vh: number): number {
  const ancho = vw - 32 + 2 * BLEED - 2 * RAIL_OUT;
  const alto = vh / 2 - ALTO_RESTA;
  return Math.min(ancho, alto, TOPE);
}

/**
 * Cuánto aire queda entre la esquina interior del indicador y el borde del
 * círculo. Negativo = lo está pisando.
 *
 * El indicador es un rectángulo pegado a la esquina de la caja de la carta. Su
 * punto más comprometido es la esquina que mira al centro: si ESA queda fuera
 * del círculo, el rectángulo entero queda fuera.
 */
function aire(d: number, altoIndicador: number): number {
  const r = d / 2;
  // Lo que el indicador entra en la caja de la carta. Si es más estrecho que la
  // reserva, no entra nada: se queda fuera del todo y no hay nada que medir.
  const muerde = Math.max(0, railW(d) - RAIL_OUT);
  const dx = r - muerde;
  const dy = r - altoIndicador;
  return Math.hypot(dx, dy) - r;
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

/** El aire mínimo que se considera "separado" y no "pegado". */
const AIRE_MIN = 8;

console.log("— Separación entre los indicadores y el círculo —\n");
console.log("  pantalla                       carta   ficha   pastilla");

for (const [nombre, vw, vh] of PANTALLAS) {
  const d = diametro(vw, vh);
  const aFicha = aire(d, chipH(d));
  const aPastilla = aire(d, pillH(d));
  console.log(
    `  ${nombre.padEnd(30)} ${String(Math.round(d)).padStart(4)}px  ` +
      `${aFicha.toFixed(1).padStart(5)}  ${aPastilla.toFixed(1).padStart(7)}`
  );
  ok(
    `    ${nombre}: la ficha de jugador no toca la carta`,
    aFicha >= AIRE_MIN,
    `solo ${aFicha.toFixed(1)}px de aire (mínimo ${AIRE_MIN})`
  );
  ok(
    `    ${nombre}: la pastilla no toca la carta`,
    aPastilla >= AIRE_MIN,
    `solo ${aPastilla.toFixed(1)}px de aire (mínimo ${AIRE_MIN})`
  );
}

/* ── Y la carta sigue siendo lo más grande posible ───────────────────────── */

console.log("\n— La carta no paga el arreglo —\n");

for (const [nombre, vw, vh] of PANTALLAS) {
  const d = diametro(vw, vh);
  const porAlto = vh / 2 - ALTO_RESTA;
  // Donde manda el alto, ensanchar los márgenes no le cuesta NADA a la carta:
  // es la mitad de la pantalla por carta, y eso no lo cambia el ancho.
  const mandaElAlto = porAlto <= vw - 32 + 2 * BLEED - 2 * RAIL_OUT;
  console.log(
    `  ${nombre.padEnd(30)} ${String(Math.round(d)).padStart(4)}px  ` +
      `${mandaElAlto ? "manda el alto (sin coste)" : "manda el ancho"}`
  );
}

{
  // Con el `bleed`, el ancho disponible es mayor que la columna de la app: sin
  // él habría que quitarle diámetro a la carta para hacer sitio a los rieles.
  const sinBleed = (vw: number) => vw - 32 - 2 * RAIL_OUT;
  const conBleed = (vw: number) => vw - 32 + 2 * BLEED - 2 * RAIL_OUT;
  ok(
    "salirse al margen le devuelve a la carta lo que se llevan los rieles",
    conBleed(393) - sinBleed(393) === 2 * BLEED,
    `${conBleed(393)} vs ${sinBleed(393)}`
  );
}

/* ── Un indicador por esquina ────────────────────────────────────────────── */

console.log("\n— Y solo cabe uno por esquina —\n");

{
  const src = readFileSync(join(ROOT, "components/arena/ArenaMatch.tsx"), "utf8");
  const grupos = [...src.matchAll(/<div className="rail-stats">([\s\S]*?)<\/div>\s*<\/aside>/g)];
  ok("hay dos grupos de indicadores, uno por riel", grupos.length === 2, `${grupos.length}`);
  for (const [i, g] of grupos.entries()) {
    const pastillas = [...g[1].matchAll(/className="stat-pill"/g)].length;
    ok(
      `    riel ${i + 1}: exactamente un indicador`,
      pastillas === 1,
      `${pastillas} pastillas apiladas — la de arriba llega al centro del círculo`
    );
  }
  ok(
    "el botón de silencio no vive en el tablero",
    !/rail-stats[\s\S]{0,400}mute-btn/.test(src),
    "volvió a apilarse con el tiempo en la esquina"
  );
  ok(
    "y la cifra de cartas no se repite: ya la lleva tu ficha",
    !/sp-emoji">🃏/.test(src),
    "la píldora CARTAS dice el mismo número que el chip del jugador"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
