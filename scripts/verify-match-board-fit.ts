// Verifica que la pantalla de partida de la Arena esté armada como se
// especificó: cuatro esquinas de posición fija, el intersticio con todos los
// controles que no son ni carta ni jugador, y el gesto de salida sostenido
// con su salida accesible aparte.
//
// La geometría en NÚMEROS —diámetro de carta, que las esquinas no toquen el
// círculo, que el intersticio alcance— la verifica
// `scripts/verify-arena-board-geometry.ts` sobre `lib/arena-board-geometry.ts`,
// que es donde vive esa cuenta de verdad. Esto de acá es estructural: que el
// marcado real siga usando esas piezas y no se haya vuelto a las columnas
// laterales, la fila horizontal arriba, o el modal de un solo toque.
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

// Normalizado a LF: en Windows el archivo puede quedar en CRLF y un
// delimitador escrito con `\n` no encontraría nada aunque el texto esté ahí.
const src = readFileSync(join(ROOT, "components/arena/ArenaMatch.tsx"), "utf8").replace(
  /\r\n/g,
  "\n"
);

console.log("\n— Las cuatro esquinas, posición fija por silla —\n");

for (const esquina of [
  "corner-base-left",
  "corner-base-right",
  "corner-mine-left",
  "corner-mine-right",
]) {
  const veces = [...src.matchAll(new RegExp(`className="corner ${esquina}"`, "g"))].length;
  ok(`hay exactamente una esquina "${esquina}"`, veces === 1, `${veces}`);
}

ok(
  "no volvieron las columnas laterales de altura completa",
  !/corner-col|match-board/.test(src),
  "eso era el diseño anterior — los módulos ahora son absolutos sobre .match-stage"
);

console.log("\n— matchSlots: tú siempre abajo-derecha —\n");

{
  const playersSrc = readFileSync(
    join(ROOT, "components/arena/ArenaMatchPlayers.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const fn = playersSrc.slice(
    playersSrc.indexOf("export function matchSlots"),
    playersSrc.indexOf("export function stateOf")
  );
  ok(
    "mineRight (abajo-derecha) es `you`, no un rival",
    /mineRight:\s*you\s*,/.test(fn),
    "el spec pide que tu módulo esté SIEMPRE abajo-derecha, no según orden de llegada"
  );
  ok(
    "baseLeft/baseRight/mineLeft son rivals[0..2], en ese orden",
    /baseLeft:\s*rivals\[0\]/.test(fn) &&
      /baseRight:\s*rivals\[1\]/.test(fn) &&
      /mineLeft:\s*rivals\[2\]/.test(fn),
    "rival 1 arriba-izq, rival 2 arriba-der, rival 3 abajo-izq"
  );
}

console.log("\n— El intersticio: todo lo que no es carta ni jugador, en una fila —\n");

{
  const gapRow = (() => {
    const i = src.indexOf('<div className="chain-gap-row">');
    if (i === -1) return null;
    const j = src.indexOf("</div>\n      </div>", i);
    return j === -1 ? null : src.slice(i, j);
  })();
  ok("hay una fila en el intersticio", gapRow !== null, "no encuentro .chain-gap-row");

  const modulos = [...(gapRow ?? "").matchAll(/className="gap-module"/g)].length;
  ok("    trae Tomadas y Castigos, ni uno más ni uno menos", modulos === 2, `${modulos} módulos`);

  ok(
    "    trae el botón de silencio y la salida accesible (dos gap-util-btn)",
    [...(gapRow ?? "").matchAll(/className="gap-util-btn"/g)].length === 2,
    "silencio + salida accesible"
  );

  ok(
    "    el gesto de salida sostenido vive ahí, no en un pie aparte",
    /<ExitHold/.test(gapRow ?? ""),
    "el botón de abandonar debe estar en el intersticio, centrado en el punto donde se tocan las cartas"
  );
}

console.log("\n— El gesto de salida y su alternativa accesible —\n");

ok(
  "ya no hay un botón de abandonar por un solo toque",
  !/className="match-quit"/.test(src),
  "el tap+modal se reemplazó por sostener — ver ExitHold.tsx"
);

ok(
  "el modal de confirmación SIGUE existiendo (no se borró, se reusa)",
  /lobby-modal-backdrop/.test(src) && /match\.quit\.confirm\.title/.test(src),
  "la salida accesible necesita el mismo cuadro de confirmación"
);

ok(
  "la salida accesible abre el modal, no llama a leave() directo",
  /onClick=\{\(\) => setQuitConfirm\(true\)\}[\s\S]{0,80}aria-label=\{t\("match\.quit\.accessible"\)\}/.test(
    src
  ),
  "un solo toque en la ✕ tiene que confirmar, no abandonar de una"
);

{
  const holdSrc = readFileSync(join(ROOT, "components/arena/ExitHold.tsx"), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  ok(
    "EXIT_HOLD_MS es la constante nombrada que pide el spec (arranca en 2500)",
    /EXIT_HOLD_MS\s*=\s*2500/.test(holdSrc),
    "el spec explícitamente pide una constante, no un número suelto"
  );
  ok(
    "contextmenu se previene — si no, Android abre el menú a los ~500ms y mata el hold",
    /onContextMenu=\{[^}]*preventDefault/.test(holdSrc),
    "falta e.preventDefault() en onContextMenu"
  );
  ok(
    "pointerdown arranca y pointerup/cancel/leave cancelan",
    /onPointerDown=/.test(holdSrc) &&
      /onPointerUp=\{cancel\}/.test(holdSrc) &&
      /onPointerCancel=\{cancel\}/.test(holdSrc) &&
      /onPointerLeave=\{cancel\}/.test(holdSrc),
    "el gesto tiene que cancelarse en los cuatro casos, no solo al soltar"
  );
  ok(
    "vibra al empezar y al completar, con chequeo de disponibilidad",
    /"vibrate" in navigator/.test(holdSrc) &&
      (holdSrc.match(/navigator\.vibrate\(/g) ?? []).length === 2,
    "10ms al empezar, 40ms al completar"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
