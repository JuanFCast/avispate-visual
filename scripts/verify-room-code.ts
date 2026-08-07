// Verifica los códigos de sala: que sean difíciles de adivinar, cómodos de
// dictar y teclear, y que las salas VIEJAS de cuatro dígitos sigan abriéndose.
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
check(
  "y eso es cien mil veces más que los 10.000 de antes",
  Math.round(combinaciones / 10_000) >= 100_000,
  true
);

const muestra = Array.from({ length: 2000 }, () => generateRoomCode());

check("todos tienen la forma correcta", muestra.every(isRoomCode), true);
check(
  "ninguno repetido en 2.000 (sin garantía, pero delataría un generador roto)",
  new Set(muestra).size,
  muestra.length
);

console.log("\n— Cómodos de dictar: sin letras que se confundan —");

const cuerpos = muestra.map((c) => c.slice(4));
for (const letra of ["I", "L", "O", "U"]) {
  check(
    `nunca sale la ${letra}`,
    cuerpos.some((b) => b.includes(letra)),
    false
  );
}

check(
  "se usa el alfabeto entero, no un rincón",
  new Set(cuerpos.join("")).size,
  32
);

console.log("\n— Se acepta lo que la gente escribe de verdad —");

check("tal cual", normalizeRoomCode("AVP-H7K2MP"), "AVP-H7K2MP");
check("en minúsculas", normalizeRoomCode("avp-h7k2mp"), "AVP-H7K2MP");
check("sin prefijo", normalizeRoomCode("h7k2mp"), "AVP-H7K2MP");
check("con espacios", normalizeRoomCode("  AVP H7K2MP "), "AVP-H7K2MP");
check("sin guion", normalizeRoomCode("AVPH7K2MP"), "AVP-H7K2MP");

console.log("\n— Y se perdonan las confusiones de siempre —");

check("la O leída donde había un cero", normalizeRoomCode("H7K2MO"), "AVP-H7K2M0");
check("la I leída donde había un uno", normalizeRoomCode("H7K2MI"), "AVP-H7K2M1");
check("la ele minúscula", normalizeRoomCode("h7k2ml"), "AVP-H7K2M1");

console.log("\n— Las salas viejas de cuatro dígitos siguen abriéndose —");

check("código viejo", normalizeRoomCode("AVP-4821"), "AVP-4821");
check("viejo sin prefijo", normalizeRoomCode("4821"), "AVP-4821");
check("viejo en minúsculas", normalizeRoomCode("avp-4821"), "AVP-4821");
check("y sigue teniendo forma válida", isRoomCode("AVP-4821"), true);

console.log("\n— Lo que no es un código, no lo es —");

check("cinco símbolos", normalizeRoomCode("H7K2M"), null);
check("siete símbolos", normalizeRoomCode("H7K2MPQ"), null);
check("con U, que nunca generamos", normalizeRoomCode("H7K2MU"), null);
check("tres dígitos", normalizeRoomCode("482"), null);
check("vacío", normalizeRoomCode(""), null);
check("solo el prefijo", normalizeRoomCode("AVP-"), null);

console.log("\n— Mientras se teclea —");

check("va poniendo el prefijo", formatRoomCodeInput("h"), "AVP-H");
check("y el guion", formatRoomCodeInput("h7k"), "AVP-H7K");
check("no deja pasar de la cuenta", formatRoomCodeInput("h7k2mpqrs"), "AVP-H7K2MP");
check("corrige al vuelo", formatRoomCodeInput("hok"), "AVP-H0K");
check("vacío se queda vacío", formatRoomCodeInput(""), "");
check("si vuelve a escribir el prefijo, no se duplica", formatRoomCodeInput("AVPH7K"), "AVP-H7K");

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
