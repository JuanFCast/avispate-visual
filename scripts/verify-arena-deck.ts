// Verifica el mazo de la Arena, que es la pieza de la que cuelga todo el modo
// de dos jugadores: si dos cartas cualesquiera NO comparten exactamente un
// símbolo, la base compartida se rompe en cuanto el rival juega y la partida
// queda sin respuesta correcta.
//
// Correr: node scripts/verify-arena-deck.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  CARDS_MIN,
  MAX_DEALT_CARDS,
  PLANE_CARDS,
  RESERVE_MIN,
  buildMatchDeck,
  cardPresets,
  clampCards,
  dealSummary,
  dealtCards,
  isDealValid,
  maxCardsPerPlayer,
  parseCardsPerPlayer,
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

/** Los tamaños de sala que el reparto tiene que saber servir. */
const SIZES = [2, 3, 4];

/** Cada tamaño con las cifras que hay que probar: mínimo, medio y máximo. */
function rangeFor(players: number): number[] {
  const { short, mid, long } = cardPresets(players);
  return [short, mid, long];
}

console.log("\nEl máximo de cartas por jugador");
{
  // La tabla de la que depende que la sala sea justa y que quepa en el plano.
  check("con 2 jugadores el máximo es 27", maxCardsPerPlayer(2), 27);
  check("con 3 jugadores el máximo es 18", maxCardsPerPlayer(3), 18);
  check("con 4 jugadores el máximo es 13", maxCardsPerPlayer(4), 13);

  check("el mínimo es 10 para todos", CARDS_MIN, 10);
  ok(
    "y el mínimo cabe en las tres salas",
    SIZES.every((p) => CARDS_MIN <= maxCardsPerPlayer(p))
  );

  for (const players of SIZES) {
    const max = maxCardsPerPlayer(players);
    const dealt = dealtCards(max, players);
    ok(
      `${players} jugadores: en el máximo reparte ${dealt} y no pasa de ${MAX_DEALT_CARDS}`,
      dealt <= MAX_DEALT_CARDS,
      `reparte ${dealt}`
    );
    ok(`${players} jugadores: cabe en el plano`, dealt <= PLANE_CARDS);
    ok(
      `${players} jugadores: quedan al menos ${RESERVE_MIN} de reserva`,
      PLANE_CARDS - dealt >= RESERVE_MIN,
      `quedan ${PLANE_CARDS - dealt}`
    );
  }

  check("el máximo con 2 reparte 55 justos", dealtCards(27, 2), 55);
  check("con 3 también 55", dealtCards(18, 3), 55);
  check("con 4 reparte 53", dealtCards(13, 4), 53);
}

console.log("\nValidación: lo que se acepta y lo que no");
{
  for (const players of SIZES) {
    for (const cards of rangeFor(players)) {
      ok(`${cards} cartas con ${players} jugadores es válido`, isDealValid(cards, players));
    }
    const max = maxCardsPerPlayer(players);
    ok(
      `${max + 1} con ${players} jugadores NO`,
      !isDealValid(max + 1, players),
      "se pasa del máximo"
    );
    ok(`9 cartas con ${players} jugadores NO`, !isDealValid(9, players));
  }

  ok("una cifra con decimales no es un reparto", !isDealValid(12.5, 2));
  ok("ni un negativo", !isDealValid(-3, 2));
  ok("una sala de 5 no tiene reparto", !isDealValid(10, 5));
  ok("ni una de 1", !isDealValid(10, 1));

  // El caso del checklist: un cuerpo de API manipulado.
  ok(
    "el servidor rechaza 40 cartas con 4 jugadores",
    parseCardsPerPlayer(40, 4) === null
  );
  ok("y no lo recorta en silencio a 13", parseCardsPerPlayer(40, 4) !== 13);
  ok("un texto donde va la cifra tampoco pasa", parseCardsPerPlayer("muchas", 2) === null);
  ok("13 con 4 jugadores sí pasa", parseCardsPerPlayer(13, 4) === 13);
  ok("y '18' como texto numérico también", parseCardsPerPlayer("18", 3) === 18);
}

console.log("\nClamp al cambiar el tamaño de la sala");
{
  // Los dos casos del checklist, que son asimétricos a propósito.
  check("27 con 2 → cambiar a 4 baja a 13", clampCards(27, 4), 13);
  check("10 con 4 → cambiar a 2 se queda en 10", clampCards(10, 2), 10);
  check("por debajo del mínimo sube a 10", clampCards(3, 2), 10);
  ok(
    "el clamp siempre deja un reparto válido",
    SIZES.every((p) => [1, 10, 19, 27, 99].every((c) => isDealValid(clampCards(c, p), p)))
  );
}

console.log("\nLos atajos del control");
{
  check("con 2: 10 / 18 / 27", cardPresets(2), { short: 10, mid: 18, long: 27 });
  check("con 3: 10 / 14 / 18", cardPresets(3), { short: 10, mid: 14, long: 18 });
  check("con 4: 10 / 11 / 13", cardPresets(4), { short: 10, mid: 11, long: 13 });
  ok(
    "los tres son válidos en su sala",
    SIZES.every((p) => rangeFor(p).every((c) => isDealValid(c, p)))
  );
}

console.log("\nEl resumen que se enseña en pantalla");
{
  // El ejemplo del anexo: 18 cartas con 2 jugadores.
  check("18 con 2 jugadores", dealSummary(18, 2), {
    dealt: 36,
    base: 1,
    inPlay: 37,
    reserve: 20,
    minutes: 4,
  });
  ok(
    "nunca muestra decimales",
    SIZES.every((p) =>
      rangeFor(p).every((c) => {
        const s = dealSummary(c, p);
        return Object.values(s).every((v) => Number.isInteger(v));
      })
    )
  );
  ok(
    "y nunca dice que dura 0 minutos",
    SIZES.every((p) => rangeFor(p).every((c) => dealSummary(c, p).minutes >= 1))
  );
}

console.log("\nLo que se reparte de verdad, sala por sala");
{
  for (const players of SIZES) {
    for (const per of rangeFor(players)) {
      const tag = `${per}×${players}`;
      const base = deck[0];
      const hands: string[][][] = [];
      for (let i = 0; i < players; i++) {
        hands.push(deck.slice(1 + i * per, 1 + (i + 1) * per));
      }

      ok(`${tag}: cada mano tiene ${per} cartas`, hands.every((h) => h.length === per));
      // Cortes consecutivos: si dos jugadores compartieran una carta, uno
      // podría jugar la que el otro tiene en la mano.
      const all = hands.flat();
      ok(
        `${tag}: ninguna carta se reparte dos veces`,
        new Set(all.map((c) => c.join(","))).size === all.length
      );
      ok(
        `${tag}: la base no está en ninguna mano`,
        !all.some((c) => c.join(",") === base.join(","))
      );
      ok(
        `${tag}: toda carta encaja con la base`,
        all.every((c) => sharedSymbol(c, base) !== null)
      );
      // La de verdad: cualquier carta de cualquiera puede volverse base.
      ok(
        `${tag}: toda carta encaja con la de cualquier otro`,
        hands.every((h, i) =>
          h.every((c) =>
            hands.every((other, j) =>
              i === j ? true : other.every((o) => sharedSymbol(c, o) !== null)
            )
          )
        )
      );

      // La reserva: lo que no se repartió, y que sigue siendo jugable.
      const reserve = deck.slice(dealtCards(per, players));
      ok(
        `${tag}: la reserva son ${PLANE_CARDS - dealtCards(per, players)}`,
        reserve.length === PLANE_CARDS - dealtCards(per, players)
      );
      ok(
        `${tag}: toda carta de reserva encaja con todo el mazo`,
        reserve.every((r) =>
          deck.every((c) => c === r || sharedSymbol(r, c) !== null)
        )
      );
    }
  }
}

console.log("\nReciclar descartes cuando la reserva se acaba");
{
  // El caso apretado: el máximo con 3, solo 2 cartas de reserva. A partir del
  // tercer castigo hay que reutilizar cartas ya jugadas.
  const dealt = dealtCards(18, 3);
  ok("el máximo con 3 deja solo 2 de reserva", PLANE_CARDS - dealt === RESERVE_MIN);
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
