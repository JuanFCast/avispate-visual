// Verifica los códigos de sala: que sean difíciles de adivinar, cómodos de
// dictar y teclear, y que sean SEIS CARACTERES y nada más.
//
// El prefijo `AVP-` se eliminó del sistema el 2026-08-08. No hay compatibilidad
// con el formato viejo a propósito, así que buena parte de este archivo existe
// para dejarlo comprobado: un código con prefijo NO es un código, y tampoco lo
// son los cuatro dígitos de la primera versión.
//
// Correr: node scripts/verify-room-code.ts
import {
  ROOM_CODE_LENGTH,
  formatRoomCodeInput,
  generateRoomCode,
  isRoomCode,
  normalizeRoomCode,
} from "../lib/arena-rooms.ts";

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

console.log("\n— Adivinarlo tiene que ser caro —");

const combinaciones = 32 ** ROOM_CODE_LENGTH;
check(
  `${ROOM_CODE_LENGTH} símbolos = ${combinaciones.toLocaleString("es")} combinaciones`,
  combinaciones > 1_000_000_000,
  true
);

const muestra = Array.from({ length: 2000 }, () => generateRoomCode());

check("todos tienen la forma correcta", muestra.every(isRoomCode), true);
check(
  "todos miden exactamente seis",
  muestra.every((c) => c.length === ROOM_CODE_LENGTH),
  true
);
check(
  "ninguno repetido en 2.000 (sin garantía, pero delataría un generador roto)",
  new Set(muestra).size,
  muestra.length
);

console.log("\n— El código es el código: sin prefijo ni adornos —");

/*
 * El PREFIJO, no la subcadena.
 *
 * Esto decía `c.includes("AVP")` y fallaba una de cada cinco corridas. No era el
 * generador: el alfabeto Crockford tiene A, V y P, así que un código aleatorio
 * de seis símbolos contiene "AVP" en alguna parte con probabilidad ~4/32³ — que
 * sobre los 2.000 de la muestra sale a un 22% por corrida. La comprobación
 * acusaba al azar de un defecto que no existía.
 *
 * Lo que se quería fijar es que un código generado no arrastre el prefijo viejo,
 * y eso es `AVP-` al principio. Que aparezcan esas tres letras en medio de un
 * código es tan irrelevante como cualquier otro trío.
 */
check(
  "ninguno arrastra el prefijo AVP-",
  muestra.some((c) => c.startsWith("AVP-")),
  false
);
check(
  "ninguno lleva guion",
  muestra.some((c) => c.includes("-")),
  false
);

console.log("\n— Cómodos de dictar: sin letras que se confundan —");

for (const letra of ["I", "L", "O", "U"]) {
  check(
    `nunca sale la ${letra}`,
    muestra.some((c) => c.includes(letra)),
    false
  );
}

check(
  "se usa el alfabeto entero, no un rincón",
  new Set(muestra.join("")).size,
  32
);

console.log("\n— Se acepta lo que la gente escribe de verdad —");

check("tal cual", normalizeRoomCode("MY37GV"), "MY37GV");
check("en minúsculas", normalizeRoomCode("my37gv"), "MY37GV");
check("con espacios alrededor", normalizeRoomCode("  MY37GV "), "MY37GV");
check("con espacios en medio", normalizeRoomCode("MY 37 GV"), "MY37GV");
check("con un guion de más", normalizeRoomCode("MY37-GV"), "MY37GV");

console.log("\n— Y se perdonan las confusiones de siempre —");

check("la O leída donde había un cero", normalizeRoomCode("MY37GO"), "MY37G0");
check("la I leída donde había un uno", normalizeRoomCode("MY37GI"), "MY37G1");
check("la ele minúscula", normalizeRoomCode("my37gl"), "MY37G1");

console.log("\n— El prefijo viejo NO se acepta, y no se mutila en silencio —");

// Esto es lo que importa de verdad del cambio. `AVP-MY37GV` limpiado son nueve
// símbolos: si `normalizeRoomCode` recortara a seis daría "AVPMY3", un código
// con forma perfecta que lleva a otra sala. Tiene que devolver `null`.
check("con prefijo y guion", normalizeRoomCode("AVP-MY37GV"), null);
check("con prefijo pegado", normalizeRoomCode("AVPMY37GV"), null);
check("con prefijo en minúsculas", normalizeRoomCode("avp-my37gv"), null);
check("y ni siquiera se parece al recorte", normalizeRoomCode("AVP-MY37GV") === "AVPMY3", false);

console.log("\n— Los códigos viejos de cuatro dígitos tampoco —");

check("cuatro dígitos", normalizeRoomCode("4821"), null);
check("cuatro dígitos con prefijo", normalizeRoomCode("AVP-4821"), null);
check("y no tienen forma válida", isRoomCode("AVP-4821"), false);

console.log("\n— Lo que no es un código, no lo es —");

check("cinco símbolos", normalizeRoomCode("MY37G"), null);
check("siete símbolos", normalizeRoomCode("MY37GVQ"), null);
check("con U, que nunca generamos", normalizeRoomCode("MY37GU"), null);
check("vacío", normalizeRoomCode(""), null);
check("solo signos", normalizeRoomCode("---"), null);

console.log("\n— Mientras se teclea —");

check("va en mayúsculas desde la primera", formatRoomCodeInput("m"), "M");
check("sin prefijo que nadie pidió", formatRoomCodeInput("my37"), "MY37");
check("no deja pasar de la cuenta", formatRoomCodeInput("my37gvqrs"), "MY37GV");
check("corrige al vuelo", formatRoomCodeInput("mo37"), "M037");
check("tira lo que no es del alfabeto", formatRoomCodeInput("my-37 gv"), "MY37GV");
check("vacío se queda vacío", formatRoomCodeInput(""), "");

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
