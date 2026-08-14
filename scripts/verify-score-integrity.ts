// Verifica que `/api/scores` ya no pueda aceptar un puntaje fabricado: el
// servidor rejuega el mazo real (misma semilla que vio el cliente) y solo
// confía en lo que él mismo recalcula a partir de los toques — nunca en
// `totalMs`/`averageMs`/`errors`/`accuracy` que mande el navegador.
//
// Antes de esto, un `POST` a mano con `averageMs: 1` y un `txHash` real
// ganaba el pozo del día sin jugar nada. Ver la auditoría del 2026-08-13 y
// `lib/score-verify.ts`.
//
// Correr: node scripts/verify-score-integrity.ts
import {
  generateFirstCard,
  generateNextCard,
  type ChainCard,
} from "../lib/game.ts";
import {
  verifyScoreMoves,
  dailyCardRnd,
  MIN_MS_PER_CARD,
  type RawMove,
} from "../lib/score-verify.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/**
 * Juega el mazo de verdad, exactamente como lo haría el cliente, con un ritmo
 * parejo y cómodamente por encima del piso físico. Es el fixture "legítimo"
 * que las pruebas de fabricación van a intentar romper.
 */
function playForReal(
  seed: string,
  deckSize: number,
  msPerCard = MIN_MS_PER_CARD * 4
): RawMove[] {
  const moves: RawMove[] = [];
  let incoming: ChainCard = generateFirstCard(dailyCardRnd(seed, 1));
  let gen = generateNextCard(incoming, 2, dailyCardRnd(seed, 2));
  let nextId = 3;
  let t = msPerCard;

  for (let i = 0; i < deckSize; i++) {
    moves.push({ symbolId: gen.targetSymbolId, tMs: t });
    incoming = gen.card;
    if (i < deckSize - 1) {
      gen = generateNextCard(incoming, nextId, dailyCardRnd(seed, nextId));
      nextId++;
      t += msPerCard;
    }
  }
  return moves;
}

const SEED = "verify-score-integrity-seed-1";
const DECK = 10;

console.log("\n— Una partida jugada de verdad se acepta —\n");

{
  const moves = playForReal(SEED, DECK);
  const result = verifyScoreMoves(SEED, DECK, moves);
  ok("la partida legítima se acepta", result.ok, JSON.stringify(result));
  if (result.ok) {
    const expectedTotal = MIN_MS_PER_CARD * 4 * DECK;
    ok(
      "el tiempo total es el que de verdad tardó, no lo que diga el cliente",
      result.score.totalMs === expectedTotal,
      `esperaba ${expectedTotal}, salió ${result.score.totalMs}`
    );
    ok("sin errores, 0 errores y 100% de precisión", result.score.errors === 0 && result.score.accuracy === 100);
  }
}

console.log("\n— El ataque real de la auditoría: números inventados, sin jugar —\n");

{
  // Esto es justo lo que `/api/scores` aceptaba antes: no hay `moves` en
  // absoluto, solo un tiempo fabricado.
  const result = verifyScoreMoves(SEED, DECK, []);
  ok("sin ningún toque, se rechaza", !result.ok, JSON.stringify(result));
}

{
  const result = verifyScoreMoves(SEED, DECK, "averageMs: 1" as unknown);
  ok("un payload que no es ni una lista, se rechaza", !result.ok);
}

console.log("\n— Fabricar solo el TIEMPO, con símbolos reales —\n");

{
  // La secuencia de símbolos es la correcta (alguien miró/derivó el mazo real
  // en algún momento), pero el tiempo entre aciertos es imposible.
  const real = playForReal(SEED, DECK);
  const tooFast = real.map((m, i) => ({ ...m, tMs: i + 1 })); // 1ms entre toques
  const result = verifyScoreMoves(SEED, DECK, tooFast);
  ok(
    "secuencia correcta pero a velocidad imposible: se rechaza",
    !result.ok && result.reason === "too_fast",
    JSON.stringify(result)
  );
}

{
  // Justo por debajo del piso en un solo salto, en medio de una partida
  // real — no basta con que el promedio se vea razonable.
  const real = playForReal(SEED, DECK);
  const cheated = real.map((m, i) =>
    i === 5 ? { ...m, tMs: real[4].tMs + MIN_MS_PER_CARD - 1 } : m
  );
  const result = verifyScoreMoves(SEED, DECK, cheated);
  ok(
    "un solo salto por debajo del piso ya lo tumba, aunque el resto sea real",
    !result.ok && result.reason === "too_fast",
    JSON.stringify(result)
  );
}

console.log("\n— Fabricar solo los SÍMBOLOS (un mazo que no es el que se jugó) —\n");

{
  // Símbolos y tiempos "razonables", pero de OTRA semilla: no corresponden al
  // mazo real que el servidor reconstruye para este txHash.
  const foreign = playForReal("otra-semilla-cualquiera", DECK);
  const result = verifyScoreMoves(SEED, DECK, foreign);
  ok(
    "una partida jugada contra la semilla equivocada no completa el mazo real",
    !result.ok && result.reason === "incomplete",
    JSON.stringify(result)
  );
}

{
  // Inventar símbolos sueltos que no existen.
  const result = verifyScoreMoves(SEED, DECK, [{ symbolId: "no-existe", tMs: 500 }]);
  ok("un símbolo que no existe en el juego se rechaza", !result.ok && result.reason === "invalid_move");
}

console.log("\n— Reordenar o alargar el envío —\n");

{
  const real = playForReal(SEED, DECK);
  const shuffled = [...real].reverse();
  const result = verifyScoreMoves(SEED, DECK, shuffled);
  ok(
    "invertir el orden rompe la monotonía del tiempo",
    !result.ok && result.reason === "non_monotonic",
    JSON.stringify(result)
  );
}

{
  const real = playForReal(SEED, DECK);
  const withTrailingJunk = real.concat([{ symbolId: real[0].symbolId, tMs: real[real.length - 1].tMs + 1000 }]);
  const result = verifyScoreMoves(SEED, DECK, withTrailingJunk);
  ok(
    "un toque de más después de terminar el mazo se rechaza",
    !result.ok && result.reason === "moves_after_finish",
    JSON.stringify(result)
  );
}

{
  const huge = Array.from({ length: DECK * 21 }, (_, i) => ({
    symbolId: "manzana",
    tMs: i * 200,
  }));
  const result = verifyScoreMoves(SEED, DECK, huge);
  ok(
    "un payload con demasiados toques se rechaza sin rejugar nada",
    !result.ok && result.reason === "too_many_moves",
    JSON.stringify(result)
  );
}

console.log("\n— Una partida real, pero un mazo distinto al pagado (deckSize equivocado) —\n");

{
  // 10 cartas jugadas de verdad, pero se declara un mazo de 15: nunca llega a
  // completar las 15 correctas porque la 11ª no existe en esta partida.
  const real = playForReal(SEED, DECK);
  const result = verifyScoreMoves(SEED, 15, real);
  ok(
    "un mazo más grande que el jugado nunca se completa",
    !result.ok && result.reason === "incomplete",
    JSON.stringify(result)
  );
}

console.log("\n— Errores de verdad SÍ se cuentan y penalizan igual que antes —\n");

{
  const base = generateFirstCard(dailyCardRnd(SEED, 1));
  const gen = generateNextCard(base, 2, dailyCardRnd(SEED, 2));
  // Un error deliberado (símbolo real de la carta, pero no el objetivo) antes
  // del primer acierto.
  const wrongSymbol = base.symbols.find((s) => s.symbolId !== gen.targetSymbolId)!.symbolId;
  const moves: RawMove[] = [
    { symbolId: wrongSymbol, tMs: MIN_MS_PER_CARD },
    ...playForReal(SEED, DECK).map((m) => ({ ...m, tMs: m.tMs + MIN_MS_PER_CARD })),
  ];
  const result = verifyScoreMoves(SEED, DECK, moves);
  ok("la partida sigue siendo válida con un error real de por medio", result.ok, JSON.stringify(result));
  if (result.ok) {
    ok("el error cuenta y penaliza 1000ms como antes", result.score.errors === 1);
  }
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
