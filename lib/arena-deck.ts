/**
 * El mazo de una partida de Arena. Puro y determinista: de una semilla salen
 * siempre las mismas 57 cartas, con los mismos símbolos en el mismo sitio.
 *
 * ── Por qué NO sirve el mazo del reto diario ────────────────────────────────
 * En el modo individual las cartas se encadenan: la carta N+1 se fabrica para
 * que comparta un símbolo con la carta N, y con ninguna otra hace falta que
 * coincida. Eso funciona porque la base solo avanza en línea recta.
 *
 * En la Arena la base cambia de dueño: en cualquier momento, la carta de tu
 * rival puede pasar a ser TU base. Entonces ya no basta con que cada carta
 * encaje con la siguiente — hace falta que CUALQUIER par de cartas del mazo
 * comparta exactamente un símbolo. Eso es un plano proyectivo (lo que hace que
 * Dobble funcione), no una cadena.
 *
 * ── El plano ────────────────────────────────────────────────────────────────
 * Orden 7 sobre GF(7): 57 cartas, 57 símbolos, 8 símbolos por carta, y dos
 * cartas cualesquiera se cruzan en exactamente uno. La partida usa 55 (una base
 * inicial + 27 para cada jugador) y las 2 sobrantes abren el montón de castigo.
 *
 * Como la propiedad vale para el plano ENTERO, una carta de castigo puede ser
 * cualquiera de las 57 sin romper nada: reciclar es seguro por construcción.
 */

import { SYMBOLS } from "./symbols.ts";
import { placeSymbols, type PlacedSymbol, type Rnd } from "./game.ts";

/** Orden del plano proyectivo. Primo, y el que da cartas de 8 símbolos. */
const ORDER = 7;

/** 57 = 7² + 7 + 1. Ni una más cabe con 8 símbolos por carta. */
export const PLANE_CARDS = ORDER * ORDER + ORDER + 1;

/** Cartas que reparte una partida a cada jugador. */
export const CARDS_PER_PLAYER = 27;

/** 1 base compartida + 27 + 27. */
export const MATCH_CARDS = 1 + CARDS_PER_PLAYER * 2;

/**
 * Semilla de texto → entero de 32 bits (xmur3). Existe para que dos semillas
 * parecidas ("...:card:1" y "...:card:2") den flujos de azar sin parentesco.
 */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Generador con semilla (mulberry32). Mismo número en Node y en el navegador. */
export function seededRnd(seed: string): Rnd {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rnd: Rnd): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Las 57 cartas del plano, como índices de símbolo 0..56.
 *
 * Construcción clásica del plano proyectivo de orden n primo:
 *   · 1 carta con el punto en el infinito y los n+1 primeros símbolos;
 *   · n cartas que comparten el símbolo 0;
 *   · n² cartas, una por cada pendiente e intersección de la "rejilla".
 * De ahí salen 1 + n + n² = 57 rectas que se cortan de a una.
 */
function planeCards(): number[][] {
  const n = ORDER;
  const cards: number[][] = [];

  const first = [0];
  for (let i = 0; i < n; i++) first.push(i + 1);
  cards.push(first);

  for (let j = 0; j < n; j++) {
    const card = [0];
    for (let k = 0; k < n; k++) card.push(n + 1 + n * j + k);
    cards.push(card);
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const card = [i + 1];
      for (let k = 0; k < n; k++) {
        card.push(n + 1 + n * k + ((i * k + j) % n));
      }
      cards.push(card);
    }
  }

  return cards;
}

/** El plano no depende de la semilla: se calcula una vez por proceso. */
let planeCache: number[][] | null = null;

function getPlane(): number[][] {
  if (!planeCache) planeCache = planeCards();
  return planeCache;
}

/**
 * El mazo de una partida: 57 cartas, cada una con sus 8 símbolos.
 *
 * La semilla decide DOS cosas: qué 57 símbolos del banco entran (el banco tiene
 * más de los que caben, así que cada partida se ve distinta) y en qué orden
 * quedan las cartas, que es como se reparten sin sesgo.
 */
export function buildMatchDeck(seed: string): string[][] {
  const symbolIds = shuffled(
    SYMBOLS.map((s) => s.id),
    seededRnd(`${seed}:symbols`)
  ).slice(0, PLANE_CARDS);

  if (symbolIds.length < PLANE_CARDS) {
    // El banco se quedó corto: sin 57 símbolos no hay plano y la partida sería
    // injugable. Mejor romper aquí, al crearla, que a mitad de un intercambio.
    throw new Error(
      `arena_deck_needs_${PLANE_CARDS}_symbols_got_${symbolIds.length}`
    );
  }

  const cards = getPlane().map((card) => card.map((i) => symbolIds[i]));
  return shuffled(cards, seededRnd(`${seed}:cards`));
}

/**
 * Los símbolos de una carta, colocados. Se deriva de la semilla y del índice,
 * así que la misma carta se dibuja igual en los dos teléfonos y sigue igual
 * cuando pasa de ser tu carta a ser la base.
 */
export function placeMatchCard(
  seed: string,
  cardIndex: number,
  symbolIds: string[]
): PlacedSymbol[] {
  return placeSymbols(symbolIds, seededRnd(`${seed}:card:${cardIndex}`));
}

/**
 * El símbolo que comparten dos cartas, o `null` si son la misma carta (que
 * comparte los ocho y no decide nada).
 *
 * Es la regla del juego, y por eso vive aquí: la usa el servidor para juzgar la
 * jugada y el cliente solo para adornar el acierto.
 */
export function sharedSymbol(a: string[], b: string[]): string | null {
  const set = new Set(a);
  const common = b.filter((s) => set.has(s));
  return common.length === 1 ? common[0] : null;
}
