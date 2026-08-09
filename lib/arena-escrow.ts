import {
  createPublicClient,
  parseEventLogs,
  type Hash,
} from "viem";
import { celo } from "viem/chains";
import { tableIdFor } from "./arena-table-id";
import { CELO_TRANSPORT } from "./chain";

// Se reexporta para que quien ya hablaba con el escrow no tenga que cambiar de
// puerta: la derivación vive aparte porque es pura y la usan las dos orillas.
export { tableIdFor };

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
 * ¿Hay contrato de escrow configurado?
 *
 * OJO con lo que significa y con lo que NO: dice si las salas que se creen A
 * PARTIR DE AHORA pueden cobrar entrada. **No dice si una sala concreta cobra.**
 * Eso lo dice `roomIsEscrowed`, mirando si esa sala tiene mesa en el contrato.
 *
 * La diferencia no es teórica. Si esto gobernara el cobro, el día que se
 * configurara la dirección todas las salas abiertas —creadas gratis, con gente
 * dentro que nunca pagó nada— se volverían pagas de golpe y sus jugadores se
 * quedarían fuera de su propia partida. Una sala nace gratis o nace paga, y no
 * cambia de naturaleza a mitad.
 */
export function escrowConfigured(): boolean {
  return /^0x[0-9a-f]{40}$/.test(ARENA_ESCROW_ADDRESS);
}

/**
 * ¿ESTA sala cobra entrada?
 *
 * La respuesta está en la propia sala: tiene mesa en el contrato o no la tiene.
 * Se decide al crearla y ya no cambia, así que ni configurar el contrato ni
 * quitarlo puede alterar lo que se le prometió a quien ya está sentado.
 */
export function roomIsEscrowed(room: { table_id?: string | null }): boolean {
  return Boolean(room.table_id);
}

const ARENA_ABI = [
  {
    type: "function",
    name: "playersOf",
    stateMutability: "view",
    inputs: [{ name: "tableId", type: "bytes32" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "event",
    name: "Joined",
    inputs: [
      { name: "tableId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "seats", type: "uint8", indexed: false },
      { name: "seatCommitment", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "seatCommitment",
    stateMutability: "view",
    inputs: [
      { name: "tableId", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const client = createPublicClient({ chain: celo, transport: CELO_TRANSPORT });

/**
 * La huella que esa dirección dejó al pagar su silla, o `null`.
 *
 * Es contra esto que se comprueba el secreto que enseña el jugador. Falla
 * cerrado por la misma razón que la lista de pagadores: si la cadena no
 * responde, no se emite ficha. Un "no lo sé" no puede abrir una silla.
 */
export async function seatCommitmentOf(
  tableId: Hash,
  player: string
): Promise<`0x${string}` | null> {
  if (!escrowConfigured()) return null;
  try {
    const commitment = (await client.readContract({
      address: ARENA_ESCROW_ADDRESS as `0x${string}`,
      abi: ARENA_ABI,
      functionName: "seatCommitment",
      args: [tableId, player as `0x${string}`],
    })) as `0x${string}`;
    // Todo ceros = esa dirección no pagó esta mesa.
    return /^0x0{64}$/i.test(commitment) ? null : commitment;
  } catch {
    return null;
  }
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
  if (!escrowConfigured()) return [];
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

export interface JoinVerification {
  ok: boolean;
  /** Quién pagó DE VERDAD, leído del evento. La cadena manda sobre el cliente. */
  player?: string;
  /** La huella que dejó al pagar. */
  commitment?: string;
  /**
   * Pagó una dirección distinta a la que afirmó el navegador. Informativo: no
   * decide nada, porque quien manda es `player`. Sirve para avisar al cliente
   * de que está mirando otra wallet, no para negarle el registro.
   */
  payerMismatch?: boolean;
}

/**
 * Verifica ON-CHAIN que `txHash` es el pago de esta mesa.
 *
 * Mismo criterio que en el reto diario y por las mismas razones: el pagador se
 * LEE del evento en vez de exigir que coincida con lo que dijo el cliente, y
 * los logs se filtran por el contrato que los emite —no por a quién iba
 * dirigida la transacción—, que es más estricto contra un evento falsificado y
 * además no deja fuera a las wallets de contrato inteligente.
 *
 * La mesa sí se exige: un pago de otra mesa no sienta a nadie aquí.
 */
export async function verifyJoinTx(
  txHash: string,
  tableId: Hash,
  /** Lo que el navegador CREE que pagó. Opcional: solo sirve para comparar. */
  expectedPlayer?: string
): Promise<JoinVerification> {
  if (!escrowConfigured()) return { ok: false };
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
    if (receipt.status !== "success") return { ok: false };

    const logs = parseEventLogs({
      abi: ARENA_ABI,
      eventName: "Joined",
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === ARENA_ESCROW_ADDRESS
      ),
    });

    const match = logs.find(
      (l) => (l.args.tableId as string).toLowerCase() === tableId.toLowerCase()
    );
    if (!match) return { ok: false };

    const player = (match.args.player as string).toLowerCase();
    return {
      ok: true,
      player,
      commitment: (match.args.seatCommitment as string).toLowerCase(),
      payerMismatch: expectedPlayer
        ? player !== expectedPlayer.toLowerCase()
        : false,
    };
  } catch {
    return { ok: false };
  }
}
