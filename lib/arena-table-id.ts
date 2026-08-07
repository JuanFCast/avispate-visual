import { keccak256, toHex, type Hash } from "viem";

/**
 * El identificador de una mesa en el contrato del escrow.
 *
 * Vive aparte del resto del puente con la cadena a propósito: lo necesitan las
 * dos orillas —el navegador, para saber qué mesa está pagando; el servidor,
 * para comprobar contra qué mesa se pagó— y ninguna de las dos debería tener
 * que arrastrar un cliente RPC solo para calcular un hash.
 *
 * Se deriva del código de sala Y de los términos, no solo del código. Así una
 * mesa con otra entrada o con otro número de jugadores es OTRA mesa: si alguien
 * intentara adelantarse abriendo la misma sala con condiciones distintas, se
 * quedaría solo en una mesa que para los demás no existe. Y como las dos partes
 * lo calculan igual, no hay que ponerse de acuerdo por ningún otro canal.
 */
export function tableIdFor(
  roomCode: string,
  entryUnits: bigint,
  maxPlayers: number
): Hash {
  return keccak256(
    toHex(`${roomCode.toUpperCase()}|${entryUnits.toString()}|${maxPlayers}`)
  );
}
