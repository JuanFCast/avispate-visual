// Verifica el mazo de la Arena, que es la pieza de la que cuelga todo el modo
// de dos jugadores: si dos cartas cualesquiera NO comparten exactamente un
// símbolo, la base compartida se rompe en cuanto el rival juega y la partida
// queda sin respuesta correcta.
//
// Correr: node scripts/verify-arena-deck.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  CARDS_PER_PLAYER,
  MATCH_CARDS,
  PLANE_CARDS,
  buildMatchDeck,
  placeMatchCard,
  sharedSymbol,
} from "../lib/arena-deck.ts";
import { SYMBOLS } from "../lib/symbols.ts";

let failed = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} · ${name}${ok ? "" : ` — esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`}`);
}

function ok(name: string, cond: boolean, detail = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "PASS" : "FAIL"} · ${name}${cond || !detail ? "" : ` — ${detail}`}`);
}

console.log("\nBanco de símbolos");
{
  ok(
    `alcanza para el plano (${SYMBOLS.length} ≥ ${PLANE_CARDS})`,
    SYMBOLS.length >= PLANE_CARDS,
    `solo hay ${SYMBOLS.length}`
  );
  const ids = new Set(SYMBOLS.map((s) => s.id));
  check("no hay ids repetidos", ids.size, SYMBOLS.length);
}

console.log("\nForma del mazo");
const deck = buildMatchDeck("semilla-de-prueba");
{
  check("son 57 cartas", deck.length, PLANE_CARDS);
  check("55 se reparten (1 + 27 + 27)", MATCH_CARDS, 55);
  ok("todas tienen 8 símbolos", deck.every((c) => c.length === 8));
  ok(
    "ninguna repite símbolo dentro de sí misma",
    deck.every((c) => new Set(c).size === 8)
  );
  const used = new Set(deck.flat());
  check("usa exactamente 57 símbolos distintos", used.size, PLANE_CARDS);
}

console.log("\nLa propiedad que sostiene la base compartida");
{
  // 57 × 56 / 2 = 1596 parejas. Se comprueban TODAS, no una muestra: basta un
  // par malo para que un jugador se quede mirando una carta sin respuesta.
  let pairs = 0;
  let bad = 0;
  let worst = "";
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      pairs++;
      const set = new Set(deck[i]);
      const common = deck[j].filter((s) => set.has(s));
      if (common.length !== 1) {
        bad++;
        if (!worst) worst = `cartas ${i} y ${j} comparten ${common.length}`;
      }
    }
  }
  check("parejas comprobadas", pairs, 1596);
  ok("todas comparten exactamente un símbolo", bad === 0, worst);
  ok(
    "sharedSymbol lo encuentra",
    deck.every((_, i) =>
      deck.every((__, j) => i === j || sharedSymbol(deck[i], deck[j]) !== null)
    )
  );
  check(
    "una carta consigo misma no decide nada",
    sharedSymbol(deck[0], deck[0]),
    null
  );
}

console.log("\nLo que se reparte de verdad");
{
  const base = deck[0];
  const mine = deck.slice(1, 1 + CARDS_PER_PLAYER);
  const theirs = deck.slice(1 + CARDS_PER_PLAYER, MATCH_CARDS);
  check("mi mazo son 27", mine.length, CARDS_PER_PLAYER);
  check("el del rival son 27", theirs.length, CARDS_PER_PLAYER);
  ok(
    "cada carta mía encaja con la base inicial",
    mine.every((c) => sharedSymbol(c, base) !== null)
  );
  ok(
    "y con cualquier carta del rival, que es la que puede volverse base",
    mine.every((c) => theirs.every((o) => sharedSymbol(c, o) !== null))
  );
  ok("sobran 2 cartas para el montón de castigo", deck.length - MATCH_CARDS === 2);
  ok(
    "una carta de castigo reciclada también encaja con todo",
    deck.every((c) => c === deck[56] || sharedSymbol(deck[56], c) !== null)
  );
}

console.log("\nDeterminismo (los dos teléfonos ven lo mismo)");
{
  const a = buildMatchDeck("misma");
  const b = buildMatchDeck("misma");
  const c = buildMatchDeck("otra");
  ok("misma semilla, mismo mazo", JSON.stringify(a) === JSON.stringify(b));
  ok("otra semilla, otro mazo", JSON.stringify(a) !== JSON.stringify(c));

  const p1 = placeMatchCard("misma", 3, a[3]);
  const p2 = placeMatchCard("misma", 3, a[3]);
  ok("la carta 3 se dibuja igual las dos veces", JSON.stringify(p1) === JSON.stringify(p2));
  ok(
    "y distinto que la carta 4, para que no se memorice la posición",
    JSON.stringify(p1) !== JSON.stringify(placeMatchCard("misma", 4, a[4]))
  );
  check("coloca los 8 símbolos", p1.length, 8);
  ok(
    "todos caben dentro de la carta",
    p1.every((s) => s.x > 5 && s.x < 95 && s.y > 5 && s.y < 95)
  );
  ok(
    "no pierde ni inventa símbolos",
    JSON.stringify([...p1.map((s) => s.symbolId)].sort()) ===
      JSON.stringify([...a[3]].sort())
  );
}

console.log("\nVariedad entre partidas");
{
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) seen.add(buildMatchDeck(`s-${i}`)[0].join(","));
  ok("50 semillas dan 50 bases distintas", seen.size === 50, `dieron ${seen.size}`);
}

console.log(
  failed === 0
    ? "\nTodo bien: el mazo aguanta la base compartida.\n"
    : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
