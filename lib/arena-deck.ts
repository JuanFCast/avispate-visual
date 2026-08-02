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
 * cartas cualesquiera se cruzan en exactamente uno. De ahí sale el tope de 55
 * repartidas (una base inicial + las manos); las sobrantes abren el montón de
 * castigo.
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
 * Cuánto dura la partida, en cartas por jugador.
 *
 * Antes esto eran dos botones —"Rápida" y "Completa"— y el número salía de una
 * tabla. Ahora es un entero que elige el anfitrión, entre `CARDS_MIN` y lo que
 * quepa. Los dos extremos siguen existiendo como atajos en pantalla, pero ya no
 * son el modelo: el modelo es la cifra.
 *
 * Todos reciben exactamente lo mismo, y por eso el reparto se mide por jugador
 * y no en total: la carrera solo es justa si las manos empiezan iguales.
 */

/** Menos de diez cartas no es una carrera, es un golpe de suerte. */
export const CARDS_MIN = 10;

/**
 * Cuánta gente cabe en una sala.
 *
 * No es una restricción del mazo —de hecho el plano repartiría bien para cinco:
 * 5 × 10 + 1 = 51, que cabe de sobra— sino de la partida, que se juega con
 * `ARENA_PLAYER_OPTIONS` de `lib/arena.ts`. Vive aquí duplicado a propósito:
 * `isDealValid` es la última barrera antes de escribir una sala en la base, y
 * una barrera que solo sabe de aritmética dejaría pasar una sala de cinco.
 */
export const PLAYERS_MIN = 2;
export const PLAYERS_MAX = 4;

/**
 * Tope de cartas repartidas, contando la base compartida.
 *
 * Son 55 y no 57 porque las que sobran no son un descarte: son la RESERVA de
 * castigos, y empezar sin ninguna obligaría a reciclar descartes desde el
 * primer error. Reciclar es seguro —el plano entero conserva la propiedad— pero
 * es mejor que sea el plan B y no el plan A.
 */
export const MAX_DEALT_CARDS = 55;

/**
 * Cuántas cartas quedan como reserva en el reparto más grande.
 *
 * Son 2, y no una cifra más generosa, precisamente porque aquí reciclar es
 * seguro por construcción: cuando la reserva se agota se barajan los descartes
 * y cualquier carta del plano sirve de castigo. En un mazo físico esto tendría
 * que ser mucho mayor; en este no, y fingir lo contrario solo le quitaría
 * cartas a la partida sin comprarle seguridad a nadie.
 */
export const RESERVE_MIN = 2;

/**
 * Segundos por carta, solo para el estimado de duración en pantalla.
 *
 * Sale del ritmo del reto diario (unos 7 s/carta en solo) redondeado a la baja:
 * en la Arena se juega más rápido porque hay alguien corriendo al lado. Es una
 * cifra de copy, no una regla — no la usa nada del juego.
 */
export const SEC_PER_CARD = 6;

/**
 * Lo máximo que se puede repartir en partes iguales sin pasarse del tope.
 * Con 2 son 27, con 3 son 18 y con 4 son 13.
 *
 * Las dos restricciones dan lo mismo aquí (`floor(54/n)`), pero se escriben las
 * dos: si algún día cambia el orden del plano, la que mande será la correcta y
 * no la que se quedó escrita a mano.
 */
export function maxCardsPerPlayer(players: number): number {
  if (players < 2) return 0;
  const byDealCap = Math.floor((MAX_DEALT_CARDS - 1) / players);
  const byDeck = Math.floor((PLANE_CARDS - RESERVE_MIN - 1) / players);
  return Math.min(byDealCap, byDeck);
}

/** Cuánto dura una partida si nadie toca el control: lo más largo que cabe. */
export function defaultCardsPerPlayer(players: number): number {
  return maxCardsPerPlayer(players);
}

/**
 * El valor dentro de sus límites. Es lo que se usa al cambiar el tamaño de la
 * sala: bajar de 27 a 13 se avisa en pantalla, pero el estado nunca se queda
 * en una cifra que no se puede repartir.
 */
export function clampCards(cards: number, players: number): number {
  return Math.min(Math.max(cards, CARDS_MIN), maxCardsPerPlayer(players));
}

/** Los tres atajos del control. Se re-etiquetan al cambiar de jugadores. */
export function cardPresets(players: number): {
  short: number;
  mid: number;
  long: number;
} {
  const max = maxCardsPerPlayer(players);
  return {
    short: CARDS_MIN,
    // A la baja: con 2 jugadores da 18, que es el punto medio de siempre.
    mid: Math.floor((CARDS_MIN + max) / 2),
    long: max,
  };
}

/** Cartas que salen del mazo al repartir: la base más las manos. */
export function dealtCards(cards: number, players: number): number {
  return 1 + cards * players;
}

/** Lo que la pantalla enseña debajo del control, ya calculado. */
export function dealSummary(cards: number, players: number) {
  const dealt = cards * players;
  return {
    /** Las que se van a las manos. */
    dealt,
    /** La del centro. Siempre una. */
    base: 1,
    inPlay: dealt + 1,
    reserve: PLANE_CARDS - dealt - 1,
    /** Redondeado al minuto: un estimado con decimales miente sobre su propia
        precisión. Mínimo uno, que "0 min" no es una duración. */
    minutes: Math.max(1, Math.round((dealt * SEC_PER_CARD) / 60)),
  };
}

/**
 * ¿Este reparto cabe? Se comprueba en el servidor antes de crear la sala y otra
 * vez antes de repartir, porque una cifra inventada desde la API sacaría cartas
 * que el plano no tiene.
 */
export function isDealValid(cards: number, players: number): boolean {
  if (players < PLAYERS_MIN || players > PLAYERS_MAX) return false;
  if (!Number.isInteger(cards) || cards < CARDS_MIN) return false;
  if (cards > maxCardsPerPlayer(players)) return false;
  const dealt = dealtCards(cards, players);
  return dealt <= MAX_DEALT_CARDS && dealt <= PLANE_CARDS;
}

/**
 * La cifra que mandó el cliente, si es una que se puede repartir en esta sala.
 * Estricto y sin corregir: aquí no se hace `clamp`. Un cuerpo de API que pide
 * 40 cartas para cuatro jugadores está pidiendo algo que no existe, y darle en
 * silencio otra cosa es peor que decirle que no.
 */
export function parseCardsPerPlayer(
  value: unknown,
  players: number
): number | null {
  const n = Number(value);
  return isDealValid(n, players) ? n : null;
}

/* ------------------------------------------------------------------------ *
 * Compatibilidad con las salas de antes                                     *
 * ------------------------------------------------------------------------ */

/**
 * El modo de mazo que se guardaba hasta ahora. La columna sigue en la base y se
 * sigue escribiendo derivada de la cifra, pero ya no decide nada: quien reparte
 * lee `cards_per_player`. Vive aquí para que las filas viejas y las nuevas
 * signifiquen lo mismo, no para que alguien vuelva a ramificar por ella.
 */
export type DeckMode = "sprint" | "full";

/** Qué modo describe mejor a esta cifra. Solo para escribir la columna. */
export function deckModeFor(cards: number, players: number): DeckMode {
  return cards >= maxCardsPerPlayer(players) ? "full" : "sprint";
}

/** Cuántas cartas repartía una sala de antes, para rellenarla al migrar. */
export function legacyCardsPerPlayer(mode: string, players: number): number {
  return mode === "sprint" ? CARDS_MIN : maxCardsPerPlayer(players);
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
