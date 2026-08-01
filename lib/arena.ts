/**
 * Configuración de una mesa de la Arena y el reparto del pozo.
 *
 * Todo son funciones puras sobre unidades enteras de USDT (6 decimales), como
 * en el resto de la app: nunca `number` para dinero, que a la tercera división
 * ya miente. Aquí no hay contrato, ni cobro, ni emparejamiento — esto solo dice
 * qué se le promete al jugador en la pantalla de elegir.
 */

import { USDT_DECIMALS } from "./contracts";

/** Entradas de la Arena, en unidades: 0.10, 0.50 y 1 USDT. */
export const ARENA_ENTRY_UNITS = [100_000n, 500_000n, 1_000_000n] as const;

/** La más barata manda: entrar a la Arena tiene que costar poco decidirlo. */
export const DEFAULT_ENTRY_UNITS = ARENA_ENTRY_UNITS[0];

/** Cuánta gente cabe en una mesa. */
export const ARENA_PLAYER_OPTIONS = [2, 3, 4] as const;

/** Dos: la mesa que antes se llena y la partida que antes empieza. */
export const DEFAULT_PLAYERS = 2;

/**
 * De las mesas que caben, cuáles se pueden JUGAR hoy.
 *
 * El motor reparte bien para 2, 3 y 4 —está probado— pero la partida en
 * pantalla se diseñó para un rival y no para tres: el tablero, el final y el
 * abandono son de a dos. Mientras eso no cambie, una mesa de 3 o 4 se puede
 * llenar pero no empezar, que es la peor forma de decir que no.
 *
 * Vive aquí, no en el motor, porque es una decisión de producto: así el
 * servidor puede frenarla en el borde y las pruebas pueden ejercitar los
 * tamaños reales sin fingir que todas las mesas son de dos.
 */
export const ARENA_PLAYABLE_PLAYERS = [2] as const;

/** ¿Esta mesa se puede terminar, no solo llenar? */
export function isPlayableTable(players: number): boolean {
  return (ARENA_PLAYABLE_PLAYERS as readonly number[]).includes(players);
}

/** Comisión de la casa sobre el pozo, en puntos básicos (20%). */
export const ARENA_COMMISSION_BPS = 2000n;

export interface ArenaPrize {
  /** Lo que entre todos ponen sobre la mesa. */
  potUnits: bigint;
  commissionUnits: bigint;
  /** Lo que se lleva quien se quede primero sin cartas. */
  winnerUnits: bigint;
}

/**
 * El reparto de una mesa. La comisión se redondea hacia abajo y el ganador se
 * queda con el resto, así que las dos cifras siempre suman el pozo exacto y no
 * aparece un céntimo de la nada al formatear.
 */
export function arenaPrize(entryUnits: bigint, players: number): ArenaPrize {
  const potUnits = entryUnits * BigInt(players);
  const commissionUnits = (potUnits * ARENA_COMMISSION_BPS) / 10_000n;
  return {
    potUnits,
    commissionUnits,
    winnerUnits: potUnits - commissionUnits,
  };
}

/** Unidades → "0.10". Sin símbolo: la unidad la pone quien lo pinta. */
export function fmtEntry(units: bigint): string {
  const text = (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
  // "1.00 USDT" en una ficha de selector se lee peor que "1".
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}

/** Unidades → "0.16", siempre con dos decimales: esto es dinero, no una ficha. */
export function fmtUsdt(units: bigint): string {
  return (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
}

/** La entrada del enlace, si es una de las nuestras; si no, la de por defecto. */
export function parseEntry(value: string | undefined): bigint {
  if (!value) return DEFAULT_ENTRY_UNITS;
  const found = ARENA_ENTRY_UNITS.find((u) => u.toString() === value);
  return found ?? DEFAULT_ENTRY_UNITS;
}

/** Los jugadores del enlace, si caben en una mesa; si no, los de por defecto. */
export function parsePlayers(value: string | undefined): number {
  const n = Number(value);
  return (ARENA_PLAYER_OPTIONS as readonly number[]).includes(n)
    ? n
    : DEFAULT_PLAYERS;
}
