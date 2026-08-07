import { createPublicClient, createWalletClient, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";
import { ARENA_ESCROW_ADDRESS, escrowConfigured, paidPlayersOf } from "./arena-escrow";

/**
 * Mover el dinero de una mesa: pagar al ganador, anular una partida rota y
 * empujar las devoluciones.
 *
 * La llave del operator vive SOLO aquí, en el servidor. Y su alcance es
 * pequeño a propósito: en `AvispateArena` el operator puede liquidar y anular,
 * pero **no puede pagar a quien no se sentó en esa mesa** —lo impide el propio
 * contrato— ni sacar fondos a ninguna dirección suya. Si esta llave se filtrara,
 * el daño llega hasta "elegir mal entre quienes ya pagaron", que es malo pero
 * no es un robo.
 *
 * Nada de aquí decide QUIÉN ganó: eso lo decide la partida. Aquí solo se
 * ejecuta lo que ya se decidió y quedó anotado.
 */

const ARENA_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tableId", type: "bytes32" },
      { name: "winner", type: "address" },
      { name: "reason", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "voidTable",
    stateMutability: "nonpayable",
    inputs: [{ name: "tableId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tableId", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tableOf",
    stateMutability: "view",
    inputs: [{ name: "tableId", type: "bytes32" }],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "entry", type: "uint256" },
      { name: "maxPlayers", type: "uint8" },
      { name: "seats", type: "uint8" },
      { name: "openedAt", type: "uint64" },
      { name: "filledAt", type: "uint64" },
    ],
  },
] as const;

/** Los mismos números que el `enum Reason` del contrato. */
export const REASON = { cleared: 0, abandoned: 1 } as const;
export type SettleReason = keyof typeof REASON;

/** Estados del `enum Status` del contrato que nos importan aquí. */
const STATUS_FULL = 2;
const STATUS_VOIDED = 4;

function getOperator() {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk || !escrowConfigured()) return null;
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`
  );
  return {
    account,
    wallet: createWalletClient({ account, chain: celo, transport: CELO_TRANSPORT }),
    pub: createPublicClient({ chain: celo, transport: CELO_TRANSPORT }),
  };
}

/** El estado de una mesa en el contrato, o null si no se pudo leer. */
export async function tableStatus(tableId: string): Promise<number | null> {
  const op = getOperator();
  if (!op) return null;
  try {
    const t = (await op.pub.readContract({
      address: ARENA_ESCROW_ADDRESS as `0x${string}`,
      abi: ARENA_ABI,
      functionName: "tableOf",
      args: [tableId as `0x${string}`],
    })) as readonly [number, bigint, number, number, bigint, bigint];
    return Number(t[0]);
  } catch {
    return null;
  }
}

/**
 * Paga la mesa al ganador.
 *
 * Se comprueba antes que la mesa siga siendo pagable. No es desconfianza del
 * contrato —él también lo comprueba y revertiría— sino de nuestro propio gasto:
 * mandar una transacción que va a revertir cuesta la tarifa igual.
 */
export async function settleTable(
  tableId: string,
  winner: string,
  reason: SettleReason
): Promise<Hash | null> {
  const op = getOperator();
  if (!op) return null;

  if ((await tableStatus(tableId)) !== STATUS_FULL) return null;

  const hash = await op.wallet.writeContract({
    address: ARENA_ESCROW_ADDRESS as `0x${string}`,
    abi: ARENA_ABI,
    functionName: "settle",
    args: [tableId as `0x${string}`, winner as `0x${string}`, REASON[reason]],
    chain: celo,
  });
  await op.pub.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Anula una mesa por fallo técnico y empuja las devoluciones.
 *
 * Empujarlas es parte del arreglo, no un extra: si la mesa se anuló porque algo
 * nuestro falló, pedirle además al jugador que gaste en una transacción para
 * recuperar lo suyo sería cobrarle nuestro error. Cada devolución va por
 * separado y a nombre del jugador; si una falla, las demás siguen.
 */
export async function voidAndRefund(
  tableId: string
): Promise<{ voided: Hash | null; refunds: { player: string; hash: Hash }[] }> {
  const op = getOperator();
  if (!op) return { voided: null, refunds: [] };

  let voided: Hash | null = null;
  if ((await tableStatus(tableId)) !== STATUS_VOIDED) {
    voided = await op.wallet.writeContract({
      address: ARENA_ESCROW_ADDRESS as `0x${string}`,
      abi: ARENA_ABI,
      functionName: "voidTable",
      args: [tableId as `0x${string}`],
      chain: celo,
    });
    await op.pub.waitForTransactionReceipt({ hash: voided });
  }

  const refunds: { player: string; hash: Hash }[] = [];
  for (const player of await paidPlayersOf(tableId as `0x${string}`)) {
    try {
      const hash = await op.wallet.writeContract({
        address: ARENA_ESCROW_ADDRESS as `0x${string}`,
        abi: ARENA_ABI,
        functionName: "refund",
        args: [tableId as `0x${string}`, player as `0x${string}`],
        chain: celo,
      });
      await op.pub.waitForTransactionReceipt({ hash });
      refunds.push({ player, hash });
    } catch {
      // Ya devuelta, o la red falló. Ninguna de las dos justifica dejar sin su
      // dinero a los demás: se sigue con el siguiente y el cron reintenta.
    }
  }

  return { voided, refunds };
}
