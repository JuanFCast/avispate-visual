// Verifica que la pantalla de partida de la Arena esté armada como se
// pidió: cuatro esquinas de posición fija dentro de `.chain-area`, la
// cintura con Tomadas/Castigos/salir en vez de una fila que le reste alto,
// y un botón de salida mínimo con tap (no gesto sostenido) que abre el
// modal de confirmación reusado.
//
// La geometría en NÚMEROS —diámetro por viewport, que nada pise el
// círculo— la verifica `scripts/verify-arena-board-geometry.ts` sobre
// `lib/arena-board-geometry.ts`. Esto de acá es estructural: que el marcado
// real siga usando esas piezas.
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

// Normalizado a LF: en Windows el archivo puede quedar en CRLF.
const src = readFileSync(join(ROOT, "components/arena/ArenaMatch.tsx"), "utf8").replace(
  /\r\n/g,
  "\n"
);

console.log("\n— Las cuatro esquinas, dentro de .chain-area, posición fija por silla —\n");

const chainArea = (() => {
  const i = src.indexOf('<div className="chain-area"');
  return i === -1 ? null : src.slice(i);
})();

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
  "las esquinas viven DENTRO de .chain-area, no en columnas laterales aparte",
  chainArea !== null && /corner-base-left/.test(chainArea) && !/corner-col|match-board/.test(src),
  "las columnas de altura completa eran el diseño anterior — ahora todo overlay va dentro de .chain-area"
);

console.log("\n— matchSlots: posición fija por asiento, tú siempre abajo-derecha —\n");

{
  const playersSrc = readFileSync(
    join(ROOT, "components/arena/ArenaMatchPlayers.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const fn = playersSrc.slice(
    playersSrc.indexOf("export function matchSlots"),
    playersSrc.indexOf("export function stateOf")
  );
  ok("mineRight (abajo-derecha) es `you`, no un rival", /mineRight:\s*you\s*,/.test(fn));
  ok(
    "baseLeft/baseRight/mineLeft son rivals[0..2], en ese orden",
    /baseLeft:\s*rivals\[0\]/.test(fn) &&
      /baseRight:\s*rivals\[1\]/.test(fn) &&
      /mineLeft:\s*rivals\[2\]/.test(fn)
  );
}

console.log("\n— La cintura: Tomadas, Castigos y salir, ni un elemento más —\n");

{
  const waistLeft = [...src.matchAll(/className="waist waist-left"/g)].length;
  const waistRight = [...src.matchAll(/className="waist waist-right"/g)].length;
  ok("hay exactamente una cintura izquierda (Tomadas)", waistLeft === 1, `${waistLeft}`);
  ok("hay exactamente una cintura derecha (Castigos)", waistRight === 1, `${waistRight}`);

  ok(
    "el botón de salir vive en la cintura, no en un pie aparte",
    /className="waist-exit"/.test(src) && !/match-foot/.test(src),
    "ya no hay .match-foot — el pie con silencio+abandonar era el diseño anterior"
  );

  ok(
    "el botón de salir es un tap simple: abre el modal, no llama a leave() directo",
    /className="waist-exit"[\s\S]{0,120}onClick=\{\(\) => setQuitConfirm\(true\)\}/.test(src),
    "un solo toque tiene que confirmar, no abandonar de una — y sin ExitHold/anillo"
  );

  ok(
    "no hay gesto sostenido (ExitHold) ni texto largo de abandonar",
    !/ExitHold|EXIT_HOLD_MS/.test(src) && !/"match-quit"/.test(src),
    "el spec pide tap, no hold — y el botón no lleva texto \"Abandonar la partida\""
  );

  ok(
    "el modal de confirmación SIGUE existiendo (se reusa, no se borró)",
    /lobby-modal-backdrop/.test(src) && /match\.quit\.confirm\.title/.test(src)
  );
}

console.log("\n— Nada le resta alto al tablero —\n");

ok(
  "los avisos (offline / no se pudo salir) son overlays, no elementos en flujo",
  !/<p className="room-warn"[^>]*>/.test(src) && /room-warn-overlay/.test(src),
  "un aviso en flujo normal empujaría el tablero y achicaría el círculo"
);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
