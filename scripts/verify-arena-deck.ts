// Verifica el mazo de la Arena, que es la pieza de la que cuelga todo el modo
// de dos jugadores: si dos cartas cualesquiera NO comparten exactamente un
// símbolo, la base compartida se rompe en cuanto el rival juega y la partida
// queda sin respuesta correcta.
//
// Correr: node scripts/verify-arena-deck.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  DECK_MODES,
  MAX_DEALT_CARDS,
  PLANE_CARDS,
  buildMatchDeck,
  cardsPerPlayer,
  dealtCards,
  isDealValid,
  parseDeckMode,
  placeMatchCard,
  sharedSymbol,
  type DeckMode,
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

console.log("\nCuántas cartas toca a cada uno");
{
  // La tabla completa de la que depende que la mesa sea justa.
  const want: [DeckMode, number, number][] = [
    ["sprint", 2, 10],
    ["sprint", 3, 10],
    ["sprint", 4, 10],
    ["full", 2, 27],
    ["full", 3, 18],
    ["full", 4, 13],
  ];
  for (const [mode, players, per] of want) {
    check(`${mode} con ${players} → ${per} por jugador`, cardsPerPlayer(mode, players), per);
  }

  for (const [mode, players] of want) {
    const dealt = dealtCards(mode, players);
    ok(
      `${mode} con ${players}: reparte ${dealt} y no pasa de ${MAX_DEALT_CARDS}`,
      dealt <= MAX_DEALT_CARDS,
      `reparte ${dealt}`
    );
    ok(`${mode} con ${players}: cabe en el plano`, dealt <= PLANE_CARDS);
    ok(`${mode} con ${players}: queda reserva de castigos`, PLANE_CARDS - dealt > 0,
      `${PLANE_CARDS - dealt}`);
    ok(`${mode} con ${players}: el reparto es válido`, isDealValid(mode, players));
  }

  check("completa con 2 reparte 55 justos", dealtCards("full", 2), 55);
  check("completa con 3 también 55", dealtCards("full", 3), 55);
  check("completa con 4 reparte 53", dealtCards("full", 4), 53);

  // Lo que hace justa la carrera: nadie empieza con más cartas que otro.
  for (const mode of DECK_MODES) {
    for (const players of [2, 3, 4]) {
      const per = cardsPerPlayer(mode, players);
      ok(
        `${mode} con ${players}: todos reciben lo mismo`,
        dealtCards(mode, players) === 1 + per * players
      );
    }
  }

  ok("un modo inventado no se acepta", parseDeckMode("gigante") === null);
  ok("ni un número donde va el modo", parseDeckMode(27) === null);
  ok("los dos reales sí", parseDeckMode("sprint") === "sprint" && parseDeckMode("full") === "full");
  ok("una mesa de 5 no tiene reparto", !isDealValid("full", 5));
  ok("ni una de 1", !isDealValid("full", 1));
}

console.log("\nLo que se reparte de verdad, mesa por mesa");
{
  for (const mode of DECK_MODES) {
    for (const players of [2, 3, 4]) {
      const per = cardsPerPlayer(mode, players);
      const base = deck[0];
      const hands: string[][][] = [];
      for (let i = 0; i < players; i++) {
        hands.push(deck.slice(1 + i * per, 1 + (i + 1) * per));
      }

      ok(
        `${mode}/${players}: cada mano tiene ${per} cartas`,
        hands.every((h) => h.length === per)
      );
      // Cortes consecutivos: si dos jugadores compartieran una carta, uno
      // podría jugar la que el otro tiene en la mano.
      const all = hands.flat();
      ok(
        `${mode}/${players}: ninguna carta se reparte dos veces`,
        new Set(all.map((c) => c.join(","))).size === all.length
      );
      ok(
        `${mode}/${players}: la base no está en ninguna mano`,
        !all.some((c) => c.join(",") === base.join(","))
      );
      ok(
        `${mode}/${players}: toda carta encaja con la base`,
        all.every((c) => sharedSymbol(c, base) !== null)
      );
      // La de verdad: cualquier carta de cualquiera puede volverse base.
      ok(
        `${mode}/${players}: toda carta encaja con la de cualquier otro`,
        hands.every((h, i) =>
          h.every((c) =>
            hands.every((other, j) =>
              i === j ? true : other.every((o) => sharedSymbol(c, o) !== null)
            )
          )
        )
      );

      // La reserva: lo que no se repartió, y que sigue siendo jugable.
      const reserve = deck.slice(dealtCards(mode, players));
      ok(
        `${mode}/${players}: la reserva son ${PLANE_CARDS - dealtCards(mode, players)}`,
        reserve.length === PLANE_CARDS - dealtCards(mode, players)
      );
      ok(
        `${mode}/${players}: toda carta de reserva encaja con todo el mazo`,
        reserve.every((r) =>
          deck.every((c) => c === r || sharedSymbol(r, c) !== null)
        )
      );
    }
  }
}

console.log("\nReciclar descartes cuando la reserva se acaba");
{
  // El caso apretado: completa con 3, solo 2 cartas de reserva. A partir del
  // tercer castigo hay que reutilizar cartas ya jugadas.
  const dealt = dealtCards("full", 3);
  ok("completa con 3 deja solo 2 de reserva", PLANE_CARDS - dealt === 2);
  ok(
    "y aun así CUALQUIER carta del mazo sirve de castigo contra cualquier base",
    deck.every((candidate) =>
      deck.every((base) => candidate === base || sharedSymbol(candidate, base) !== null)
    )
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
