// Verifica lo que sostiene el flujo con dinero de la Arena: que el
// identificador de la mesa sea estable y distinga los términos, y que un choque
// contra un índice único se lea bien —reintento contra colisión de verdad—.
//
// Correr: node scripts/verify-arena-escrow.ts
//
// Sin base de datos: lo que se prueba aquí es la decisión, que es lo que puede
// equivocarse. Los índices únicos los impone Postgres y están en la migración
// `20260808000000_arena_escrow.sql`.
import { tableIdFor } from "../lib/arena-table-id.ts";
import { classifySeatWrite } from "../lib/arena-idempotency.ts";

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

const TX = "0x" + "ab".repeat(32);
const OTRO_TX = "0x" + "cd".repeat(32);

console.log("\n— El identificador de la mesa —");

check(
  "mismo código y mismos términos → misma mesa (cliente y servidor coinciden)",
  tableIdFor("MY37GV", 100_000n, 2),
  tableIdFor("MY37GV", 100_000n, 2)
);

check(
  "el código no distingue mayúsculas",
  tableIdFor("my37gv", 100_000n, 2),
  tableIdFor("MY37GV", 100_000n, 2)
);

check(
  "otra ENTRADA es otra mesa",
  tableIdFor("MY37GV", 500_000n, 2) === tableIdFor("MY37GV", 100_000n, 2),
  false
);

check(
  "otro número de JUGADORES es otra mesa",
  tableIdFor("MY37GV", 100_000n, 4) === tableIdFor("MY37GV", 100_000n, 2),
  false
);

check(
  "otro código es otra mesa",
  tableIdFor("9XQ4TP", 100_000n, 2) === tableIdFor("MY37GV", 100_000n, 2),
  false
);

console.log("\n— Reintentar un pago NO crea una segunda silla —");

check(
  "el mismo pago otra vez → duplicado, y eso es éxito",
  classifySeatWrite({ join_tx_hash: TX }, TX),
  { status: "duplicate" }
);

check(
  "el mismo pago en mayúsculas sigue siendo el mismo",
  classifySeatWrite({ join_tx_hash: TX }, TX.toUpperCase()),
  { status: "duplicate" }
);

console.log("\n— Y una colisión de verdad NO se disfraza de reintento —");

check(
  "esa dirección ya tiene silla con OTRO pago → conflicto, no se sienta dos veces",
  classifySeatWrite({ join_tx_hash: OTRO_TX }, TX),
  { status: "conflict", reason: "wallet_already_seated" }
);

check(
  "chocó el asiento y no hay fila de esa dirección → otro llegó primero",
  classifySeatWrite(null, TX),
  { status: "conflict", reason: "seat_taken" }
);

check(
  "fila sin hash (silla de una mesa gratis) → no se toma por el mismo pago",
  classifySeatWrite({ join_tx_hash: null }, TX),
  { status: "conflict", reason: "wallet_already_seated" }
);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
