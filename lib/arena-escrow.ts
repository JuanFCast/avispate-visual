import { createPublicClient, keccak256, toHex, type Hash } from "viem";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";

/**
 * El puente con el escrow de la Arena (`contracts/AvispateArena.sol`).
 *
 * Aquí solo se LEE. Quién está sentado en una mesa con entrada lo dice el
 * contrato, no una fila de la base de datos creada por una sesión: esa es la
 * mitad on-chain de la regla que vive en `arena-seat.ts`.
 */

/** Dirección del escrow. Sin ella, la Arena sigue siendo gratis. */
export const ARENA_ESCROW_ADDRESS = (
  process.env.NEXT_PUBLIC_AVISPATE_ARENA_ADDRESS ?? ""
).toLowerCase();

/**
 * ¿Las mesas de la Arena cobran entrada?
 *
 * Hoy es un interruptor global: mientras no haya contrato configurado, todo
 * sigue gratis y `decideSeatAccess` deja pasar a todo el mundo — que es lo que
 * permite desplegar la regla ANTES que el contrato sin romperle la partida a
 * nadie. Cuando el escrow exista de verdad, esto pasa a ser por mesa (una
 * columna `table_id` en `arena_rooms`), porque habrá que poder tener mesas
 * gratis y mesas pagas a la vez.
 */
export function escrowEnabled(): boolean {
  return /^0x[0-9a-f]{40}$/.test(ARENA_ESCROW_ADDRESS);
}

const ARENA_ABI = [
  {
    type: "function",
    name: "playersOf",
    stateMutability: "view",
    inputs: [{ name: "tableId", type: "bytes32" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

const client = createPublicClient({ chain: celo, transport: CELO_TRANSPORT });

/**
 * El identificador de la mesa en el contrato.
 *
 * Se calcula a partir del código de sala Y de los términos, no solo del código.
 * Así una mesa con otra entrada o con otro número de jugadores es OTRA mesa: si
 * alguien intentara adelantarse abriendo la misma sala con condiciones
 * distintas, se quedaría solo en una mesa que para los demás no existe.
 *
 * El cliente calcula lo mismo antes de firmar el `join`, así que las dos partes
 * hablan de la misma mesa sin tener que ponerse de acuerdo por otro canal.
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

/**
 * Quiénes pagaron esta mesa, según el contrato. En minúsculas.
 *
 * Falla CERRADO, igual que el guardián del cobro: si la cadena no responde se
 * devuelve lista vacía, y sin lista no hay silla. Dejar pasar a alguien porque
 * el RPC iba lento sería exactamente la puerta que este cheque existe para
 * cerrar.
 */
export async function paidPlayersOf(tableId: Hash): Promise<string[]> {
  if (!escrowEnabled()) return [];
  try {
    const players = (await client.readContract({
      address: ARENA_ESCROW_ADDRESS as `0x${string}`,
      abi: ARENA_ABI,
      functionName: "playersOf",
      args: [tableId],
    })) as readonly string[];
    return players.map((p) => p.toLowerCase());
  } catch {
    return [];
  }
}
