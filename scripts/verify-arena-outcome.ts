// Verifica cómo termina una mesa con dinero: que ganar jugando mande sobre
// todo, que abandonar NO devuelva la entrada, y que el margen de gracia no se
// pueda usar para escaparse de una derrota.
//
// Correr: node scripts/verify-arena-outcome.ts
import {
  decideMatchOutcome,
  type SeatState,
} from "../lib/arena-outcome.ts";

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

const ALICE = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const BOB = "0xfd43f6003484579ca068313736632eea8c651477";
const CAROL = "0x1246294f454710670deccf9ec6545c4241d40202";

const AHORA = 1_770_000_000_000;
const GRACIA = 90_000; // 90 s

const silla = (address: string, o: Partial<SeatState> = {}): SeatState => ({
  address,
  cleared: false,
  left: false,
  lastSeenAt: AHORA,
  ...o,
});

const fin = (seats: SeatState[]) => decideMatchOutcome(seats, AHORA, GRACIA);

console.log("\n— Ganar jugando —");

check(
  "alguien vació su mazo → cobra él",
  fin([silla(ALICE, { cleared: true }), silla(BOB)]),
  { kind: "settle", winner: ALICE, reason: "cleared" }
);

check(
  "terminar GANA a desconectarse en el mismo instante",
  fin([
    silla(ALICE, { cleared: true }),
    silla(BOB, { left: true }),
  ]),
  { kind: "settle", winner: ALICE, reason: "cleared" }
);

console.log("\n— Abandonar NO devuelve la entrada —");

check(
  "se levanta uno → cobra el que se queda",
  fin([silla(ALICE, { left: true }), silla(BOB)]),
  { kind: "settle", winner: BOB, reason: "abandoned" }
);

check(
  "no vuelve dentro del margen → cobra el que se queda",
  fin([silla(ALICE, { lastSeenAt: AHORA - GRACIA - 1 }), silla(BOB)]),
  { kind: "settle", winner: BOB, reason: "abandoned" }
);

check(
  "vuelve JUSTO en el límite → la partida sigue, no se le castiga",
  fin([silla(ALICE, { lastSeenAt: AHORA - GRACIA }), silla(BOB)]),
  { kind: "playing" }
);

check(
  "en una mesa de tres, se va uno y siguen dos → la partida sigue",
  fin([silla(ALICE, { left: true }), silla(BOB), silla(CAROL)]),
  { kind: "playing" }
);

check(
  "en una mesa de tres, se van dos → cobra el que aguantó",
  fin([
    silla(ALICE, { left: true }),
    silla(BOB, { lastSeenAt: AHORA - GRACIA - 1 }),
    silla(CAROL),
  ]),
  { kind: "settle", winner: CAROL, reason: "abandoned" }
);

console.log("\n— Desconectarse NO es una forma de recuperar la entrada —");

check(
  "el que se va no aparece nunca como ganador",
  fin([silla(ALICE, { left: true }), silla(BOB)]).kind === "settle" &&
    (fin([silla(ALICE, { left: true }), silla(BOB)]) as { winner: string })
      .winner !== ALICE,
  true
);

check(
  "irse de una mesa de dos NUNCA da devolución",
  fin([silla(ALICE, { left: true }), silla(BOB)]).kind === "void",
  false
);

console.log("\n— Sin nadie a quien pagarle —");

check(
  "se van los dos → se anula (los dos pierden lo mismo; nadie gana)",
  fin([silla(ALICE, { left: true }), silla(BOB, { left: true })]),
  { kind: "void", why: "everyone_left" }
);

check(
  "nadie aparece hace rato → se anula",
  fin([
    silla(ALICE, { lastSeenAt: AHORA - GRACIA - 1 }),
    silla(BOB, { lastSeenAt: AHORA - GRACIA - 1 }),
  ]),
  { kind: "void", why: "everyone_left" }
);

check("mesa sin sillas → se anula", fin([]), {
  kind: "void",
  why: "everyone_left",
});

console.log("\n— Partida normal —");

check("los dos jugando → nada que hacer", fin([silla(ALICE), silla(BOB)]), {
  kind: "playing",
});

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
