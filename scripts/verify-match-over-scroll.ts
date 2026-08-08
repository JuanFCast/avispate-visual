// Verifica que la pantalla de resultados de la Arena SE PUEDA DESPLAZAR.
//
// ── Qué se rompió, para que no vuelva a romperse ────────────────────────────
//
// La página de la partida pintaba `<main class="shell playing match-shell">`
// con las clases escritas a mano, y `.shell.playing` clava `height: 100dvh` y
// `overflow: hidden` porque el tablero tiene que caber en una pantalla. Al
// terminar la partida el contenido cambiaba y el candado no: los resultados
// quedaban recortados al alto del viewport, sin forma de bajar hasta "Otra
// sala". En Chrome de escritorio cabía y no se veía; en MiniPay, con el WebView
// comiéndose alto, no cabía. Y le pasaba a UNO de los dos jugadores porque el
// que pierde tiene una línea más ("Quedaste 2º de 3").
//
// ── Qué comprueba esto ──────────────────────────────────────────────────────
//
//   1. `matchShellClass` deja el candado puesto jugando y lo suelta al terminar.
//   2. La cascada de verdad: se parsea `app/globals.css`, se arma la cadena de
//      elementos de la pantalla de resultados tal como la pinta el componente y
//      se resuelven las propiedades que impiden desplazarse. Nada de buscar
//      cadenas de texto: si mañana alguien esconde el desbordamiento desde otro
//      selector, o desde una media query, esto lo ve igual.
//   3. Que el candado del TABLERO siga puesto. Arreglar el scroll apagándolo
//      durante la partida sería cambiar un problema por otro.
//   4. Que nada de la cadena capture los toques (`pointer-events: none`,
//      `position: fixed` de un overlay) ni bloquee el gesto vertical
//      (`touch-action`), y que el botón "Otra sala" siga en la pantalla.
//
// Lo que NO comprueba: el WebView de MiniPay de verdad. Eso hay que tocarlo con
// el dedo — esto es la red que impide que la regresión llegue hasta ahí.
//
// Correr: node scripts/verify-match-over-scroll.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matchShellClass } from "../lib/arena-match.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok
        ? ""
        : `\n         esperado ${JSON.stringify(expected)}` +
          `\n         recibido ${JSON.stringify(actual)}`)
  );
}

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(`${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`);
}

/* ========================================================================== *
 * Un pedazo de CSS: lo justo para resolver la cascada de esta pantalla.
 * ========================================================================== */

interface Rule {
  selectors: string[];
  decls: Map<string, string>;
  /** Condición de la media query que la envuelve, si la hay. */
  media: string | null;
  /** Posición en el archivo: desempata entre reglas de la misma especificidad. */
  order: number;
}

/** Viewport contra el que se evalúan las media queries: un teléfono vertical. */
const PHONE = { width: 390, height: 740 };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Parte el CSS en reglas. Reconoce bloques anidados de un nivel (`@media`), que
 * es todo lo que usa esta hoja; cualquier otro `@algo { … }` se recorre igual
 * para no perder las reglas de dentro.
 */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;

  function walk(source: string, media: string | null) {
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf("{", i);
      if (open === -1) break;

      const prelude = source.slice(i, open).trim();
      // Buscar el cierre equilibrado del bloque.
      let depth = 1;
      let j = open + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === "{") depth++;
        else if (source[j] === "}") depth--;
        j++;
      }
      const body = source.slice(open + 1, j - 1);

      if (prelude.startsWith("@")) {
        // Solo las media queries condicionan; las demás (@keyframes, @font-face)
        // no tienen selectores que nos interesen, pero recorrerlas no estorba.
        const condition = prelude.startsWith("@media")
          ? prelude.slice("@media".length).trim()
          : null;
        if (prelude.startsWith("@media")) walk(body, condition);
      } else if (prelude) {
        rules.push({
          selectors: prelude.split(",").map((s) => s.trim()).filter(Boolean),
          decls: parseDecls(body),
          media,
          order: order++,
        });
      }

      i = j;
    }
  }

  walk(css, null);
  return rules;
}

function parseDecls(body: string): Map<string, string> {
  const decls = new Map<string, string>();
  // Sin bloques anidados dentro: los que hubiera ya los sacó `walk`.
  for (const piece of body.split(";")) {
    const colon = piece.indexOf(":");
    if (colon === -1) continue;
    const prop = piece.slice(0, colon).trim().toLowerCase();
    const value = piece.slice(colon + 1).trim();
    if (!prop || prop.startsWith("@") || piece.includes("{")) continue;
    decls.set(prop, value);
  }
  return decls;
}

/**
 * ¿Se aplica esta media query en un teléfono vertical?
 *
 * Entiende `min-width`, `max-width`, `min-height`, `max-height` y
 * `orientation`, que es todo lo que hay en la hoja. Lo que no sepa leer lo da
 * por aplicable: para un detector de candados de scroll, equivocarse avisando
 * de más es barato y equivocarse callando no.
 */
function mediaApplies(condition: string | null): boolean {
  if (!condition) return true;
  // Una lista separada por comas es un "o".
  return condition.split(",").some((clause) => {
    return clause
      .split(/\band\b/)
      .map((f) => f.trim())
      .filter(Boolean)
      .every((feature) => {
        const m = /^\(\s*([a-z-]+)\s*:\s*([^)]+)\)$/.exec(feature);
        if (!m) return true;
        const [, name, raw] = m;
        const px = Number.parseFloat(raw);
        switch (name) {
          case "min-width":
            return PHONE.width >= px;
          case "max-width":
            return PHONE.width <= px;
          case "min-height":
            return PHONE.height >= px;
          case "max-height":
            return PHONE.height <= px;
          case "orientation":
            return raw.trim() === "portrait";
          default:
            // `prefers-reduced-motion` y compañía: no deciden nada de scroll.
            return true;
        }
      });
  });
}

/* ========================================================================== *
 * Emparejar selectores contra una cadena de elementos.
 * ========================================================================== */

interface El {
  tag: string;
  classes: Set<string>;
}

const el = (tag: string, ...classes: string[]): El => ({
  tag,
  classes: new Set(classes),
});

interface Compound {
  tag: string | null;
  classes: string[];
  /** Pseudo-clases de estado: una regla de `:active` no describe el reposo. */
  stateful: boolean;
}

function parseCompound(text: string): Compound | null {
  if (text === "*") return { tag: null, classes: [], stateful: false };
  const stateful = /::|:(?!not\()/.test(text);
  const bare = text.replace(/::?[a-z-]+(\([^)]*\))?/g, "");
  const classes = [...bare.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const tagMatch = /^([a-z][a-z0-9]*)/.exec(bare);
  // Atributos e ids no aparecen en esta hoja; si aparecieran, no emparejar.
  if (/[[\]#]/.test(bare)) return null;
  return { tag: tagMatch ? tagMatch[1] : null, classes, stateful };
}

function compoundMatches(c: Compound, e: El): boolean {
  if (c.tag && c.tag !== e.tag) return false;
  return c.classes.every((cls) => e.classes.has(cls));
}

/**
 * ¿Este selector señala al último elemento de la cadena?
 *
 * La cadena va de raíz a hoja. Se emparejan los compuestos de derecha a
 * izquierda: el último contra la hoja, y los anteriores contra cualquier
 * antepasado, en orden. `>` se trata como descendiente porque en estas cadenas
 * todo antepasado es padre directo.
 */
function selectorMatches(selector: string, chain: El[]): boolean {
  const parts = selector
    .replace(/\s*>\s*/g, " ")
    .replace(/\s*\+\s*/g, " + ")
    .split(/\s+/)
    .filter(Boolean);
  // Hermanos: esta hoja no los usa contra la cadena que nos importa.
  if (parts.includes("+") || parts.includes("~")) return false;

  const compounds = parts.map(parseCompound);
  if (compounds.some((c) => c === null)) return false;

  const subject = compounds[compounds.length - 1]!;
  if (subject.stateful) return false;
  if (!compoundMatches(subject, chain[chain.length - 1])) return false;

  let idx = chain.length - 2;
  for (let k = compounds.length - 2; k >= 0; k--) {
    const c = compounds[k]!;
    while (idx >= 0 && !compoundMatches(c, chain[idx])) idx--;
    if (idx < 0) return false;
    idx--;
  }
  return true;
}

/** (clases + pseudo-clases, elementos). Sin ids en esta hoja. */
function specificity(selector: string): [number, number] {
  const bare = selector.replace(/\s*[>+~]\s*/g, " ");
  const classes = (bare.match(/\.[A-Za-z0-9_-]+/g) ?? []).length;
  const pseudoClasses = (bare.match(/(?<!:):[a-z-]+/g) ?? []).length;
  const tags = bare
    .split(/\s+/)
    .filter((p) => /^[a-z]/.test(p)).length;
  return [classes + pseudoClasses, tags];
}

/** Las propiedades que de verdad quedan puestas sobre el último de la cadena. */
function computed(rules: Rule[], chain: El[]): Map<string, string> {
  const winners = new Map<string, { spec: [number, number]; order: number; value: string }>();

  for (const rule of rules) {
    if (!mediaApplies(rule.media)) continue;
    for (const selector of rule.selectors) {
      if (!selectorMatches(selector, chain)) continue;
      const spec = specificity(selector);
      for (const [prop, value] of rule.decls) {
        const prev = winners.get(prop);
        const beats =
          !prev ||
          spec[0] > prev.spec[0] ||
          (spec[0] === prev.spec[0] && spec[1] > prev.spec[1]) ||
          (spec[0] === prev.spec[0] && spec[1] === prev.spec[1] && rule.order >= prev.order);
        if (beats) winners.set(prop, { spec, order: rule.order, value });
      }
    }
  }

  const out = new Map<string, string>();
  for (const [prop, win] of winners) out.set(prop, win.value);
  return out;
}

/** El desbordamiento vertical resuelto, mirando el atajo y la propiedad larga. */
function overflowY(style: Map<string, string>): string {
  const long = style.get("overflow-y");
  if (long) return long;
  const short = style.get("overflow");
  if (!short) return "visible";
  const parts = short.split(/\s+/);
  return parts.length > 1 ? parts[1] : parts[0];
}

/** ¿Este alto encierra el contenido en una pantalla? */
function locksHeight(style: Map<string, string>): boolean {
  const h = style.get("height");
  return Boolean(h && /\b(100dvh|100vh|100%)\b/.test(h));
}

/* ========================================================================== *
 * Las comprobaciones
 * ========================================================================== */

const css = stripComments(readFileSync(join(ROOT, "app/globals.css"), "utf8"));
const rules = parseRules(css);

console.log(`\nHoja leída: ${rules.length} reglas\n`);

/* --- 1. El candado depende de la fase ------------------------------------ */

const finishedClasses = matchShellClass("finished").split(/\s+/);
const playingClasses = matchShellClass("playing").split(/\s+/);

check("jugando lleva el candado", playingClasses.includes("playing"), true);
check(
  "en cuenta regresiva también",
  matchShellClass("countdown").split(/\s+/).includes("playing"),
  true
);
check("terminada NO lleva el candado", finishedClasses.includes("playing"), false);
check(
  "sin fase todavía tampoco",
  matchShellClass(null).split(/\s+/).includes("playing"),
  false
);

/* --- 2. La cascada de la pantalla de resultados --------------------------- */

const html = el("html");
const body = el("body");
const resultShell = el("main", ...finishedClasses);
// Con premio o sin él, y ganando o perdiendo: la tarjeta más alta es la que
// más tiene que contar, así que se comprueba esa.
const card = el("section", "arena-card", "match-over", "won");
const table = el("table", "match-table");
const cta = el("a", "arena-cta");

const resultChain = [html, body, resultShell, card];

for (const [name, chain] of [
  ["html", [html]],
  ["body", [html, body]],
  ["el contenedor de resultados", [html, body, resultShell]],
  ["la tarjeta de resultados", resultChain],
] as const) {
  const style = computed(rules, chain as unknown as El[]);
  ok(
    `${name}: el desbordamiento vertical no está escondido`,
    !["hidden", "clip"].includes(overflowY(style)),
    `overflow-y resuelto = ${overflowY(style)}`
  );
  ok(
    `${name}: el alto no encierra el contenido en una pantalla`,
    !locksHeight(style),
    `height = ${style.get("height")}`
  );
  ok(
    `${name}: no está fijado a la ventana`,
    style.get("position") !== "fixed",
    `position = ${style.get("position")}`
  );
  ok(
    `${name}: el gesto vertical no está bloqueado`,
    !["none", "pan-x"].includes(style.get("touch-action") ?? ""),
    `touch-action = ${style.get("touch-action")}`
  );
  ok(
    `${name}: recibe los toques`,
    style.get("pointer-events") !== "none",
    `pointer-events = ${style.get("pointer-events")}`
  );
}

// Y además crece: alto mínimo de pantalla, para que con poco contenido la
// pantalla se vea llena y con mucho se desborde en vez de recortarse.
const shellStyle = computed(rules, [html, body, resultShell]);
ok(
  "el contenedor de resultados usa alto MÍNIMO de viewport",
  /\b100dvh\b/.test(shellStyle.get("min-height") ?? ""),
  `min-height = ${shellStyle.get("min-height")}`
);

// La tabla y el botón de salida tampoco pueden estar tapados ni recortados.
for (const [name, leaf] of [
  ["la tabla de resultados", table],
  ["el botón de salida", cta],
] as const) {
  const style = computed(rules, [...resultChain, leaf]);
  ok(
    `${name}: recibe los toques`,
    style.get("pointer-events") !== "none",
    `pointer-events = ${style.get("pointer-events")}`
  );
  ok(
    `${name}: no está fijado a la ventana`,
    style.get("position") !== "fixed",
    `position = ${style.get("position")}`
  );
}

/* --- 3. El candado del tablero sigue puesto ------------------------------- */

const boardShell = el("main", ...playingClasses);
const boardStyle = computed(rules, [html, body, boardShell]);

ok(
  "jugando: el tablero SÍ se queda en una pantalla",
  overflowY(boardStyle) === "hidden" && locksHeight(boardStyle),
  `overflow-y = ${overflowY(boardStyle)}, height = ${boardStyle.get("height")}`
);

/* --- 4. La estructura que pinta el componente ----------------------------- */

const matchSrc = readFileSync(join(ROOT, "components/arena/ArenaMatch.tsx"), "utf8");
const overSrc = readFileSync(join(ROOT, "components/arena/ArenaMatchOver.tsx"), "utf8");
const pageSrc = readFileSync(
  join(ROOT, "app/arena/partida/[codigo]/page.tsx"),
  "utf8"
);

ok(
  "la página no escribe las clases del contenedor a mano",
  !/className="[^"]*\bshell\b/.test(pageSrc),
  "volvió el `<main className=\"shell playing …\">` que causó el fallo"
);
ok(
  "el final de la partida se pinta con la fase 'finished'",
  /<MatchShell phase="finished">/.test(matchSrc),
  "la pantalla de resultados tiene que declarar su fase, no heredarla"
);
ok(
  "nada del tablero se cuela en los resultados",
  !/match-board|match-rail/.test(overSrc),
  "los rieles se superponen con `pointer-events` y no pintan nada aquí"
);
ok(
  "el botón 'Otra sala' está en los resultados",
  /href="\/arena\/crear"/.test(overSrc),
  "es la salida de la pantalla: sin él no hay a dónde ir"
);
ok(
  "los resultados cuentan las manos tomadas",
  /player\.correct/.test(overSrc) && /match\.over\.taken/.test(overSrc),
  "por jugador en la tabla y el total arriba"
);
ok(
  "los resultados dicen qué pasó con la plata",
  /stakes/.test(overSrc) && /match\.over\.prize\./.test(overSrc),
  "cuánto se ganó y si el pago ya salió"
);

console.log(failed === 0 ? "\nTodo bien.\n" : `\n${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);
