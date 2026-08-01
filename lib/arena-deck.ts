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

/**
 * Cuántas cartas se reparten.
 *
 * OJO con el nombre: esto NO es el modo de entrar a la Arena (partida rápida vs
 * sala privada). Es cuánto dura la partida. En pantalla se llaman "Rápida" y
 * "Completa"; aquí `sprint` y `full` para que nadie confunda las dos cosas al
 * leer el código.
 */
export type DeckMode = "sprint" | "full";

export const DECK_MODES = ["sprint", "full"] as const;

/** La partida larga es la que había hasta ahora. */
export const DEFAULT_DECK_MODE: DeckMode = "full";

/** "Rápida": diez cartas, sin importar cuánta gente haya. */
export const SPRINT_CARDS_PER_PLAYER = 10;

/**
 * "Completa": lo máximo que se puede repartir en partes iguales sin pasarse del
 * tope. Con 2 son 27, con 3 son 18 y con 4 son 13 — y siempre le toca lo mismo
 * a todo el mundo, que es lo que hace justa la carrera.
 */
const FULL_CARDS_BY_PLAYERS: Readonly<Record<number, number>> = {
  2: 27,
  3: 18,
  4: 13,
};

/**
 * Tope de cartas repartidas, contando la base compartida.
 *
 * Son 55 y no 57 porque las que sobran no son un descarte: son la RESERVA de
 * castigos, y empezar sin ninguna obligaría a reciclar descartes desde el
 * primer error. Reciclar es seguro —el plano entero conserva la propiedad— pero
 * es mejor que sea el plan B y no el plan A.
 */
export const MAX_DEALT_CARDS = 55;

/** Cuántas cartas recibe cada jugador. Todos la misma cantidad, siempre. */
export function cardsPerPlayer(mode: DeckMode, players: number): number {
  return mode === "sprint"
    ? SPRINT_CARDS_PER_PLAYER
    : (FULL_CARDS_BY_PLAYERS[players] ?? 0);
}

/** Cartas que salen del mazo al repartir: la base más las manos. */
export function dealtCards(mode: DeckMode, players: number): number {
  return 1 + cardsPerPlayer(mode, players) * players;
}

/**
 * ¿Este reparto cabe? Se comprueba en el servidor antes de crear la sala y otra
 * vez antes de repartir, porque una combinación inventada desde la URL o desde
 * la API sacaría cartas que el plano no tiene.
 */
export function isDealValid(mode: DeckMode, players: number): boolean {
  const per = cardsPerPlayer(mode, players);
  if (per <= 0) return false;
  const dealt = dealtCards(mode, players);
  return dealt <= MAX_DEALT_CARDS && dealt <= PLANE_CARDS;
}

/** El modo del cliente, si es uno de los nuestros. Estricto: nada de suponer. */
export function parseDeckMode(value: unknown): DeckMode | null {
  return (DECK_MODES as readonly string[]).includes(value as string)
    ? (value as DeckMode)
    : null;
}

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
