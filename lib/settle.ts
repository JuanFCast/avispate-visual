import {
  createPublicClient,
  createWalletClient,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";
import { AVISPATE_POT_ADDRESS, AVISPATE_POT_ABI } from "./contracts";

/**
 * Cliente del Operator Bot para liquidar rondas. La clave vive SOLO en el
 * servidor (`OPERATOR_PRIVATE_KEY`). El operator solo puede `settle`, no retirar
 * ni cambiar config: blast radius mínimo si la llave se filtrara.
 */
function getOperator() {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk || !AVISPATE_POT_ADDRESS) return null;
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`
  );
  return {
    account,
    wallet: createWalletClient({ account, chain: celo, transport: CELO_TRANSPORT }),
    pub: createPublicClient({ chain: celo, transport: CELO_TRANSPORT }),
  };
}

/** Saldo actual del pozo de un mazo, en unidades del token. */
export async function readPot(deck: number): Promise<bigint> {
  const op = getOperator();
  if (!op) return 0n;
  try {
    return (await op.pub.readContract({
      address: AVISPATE_POT_ADDRESS as `0x${string}`,
      abi: AVISPATE_POT_ABI,
      functionName: "pot",
      args: [deck],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/**
 * Gas fijo para `settle`, por la misma razón que en `seedPot` (ver `seed.ts`):
 * las tres liquidaciones viajan juntas, así que estimar contra el estado previo
 * subestima. Aquí el salto caro es el ganador que nunca ha tenido USDT: su
 * saldo pasa de cero a no-cero y son 20.000 gas que la estimación no vio.
 */
const SETTLE_GAS = 200_000n;

export interface SettleResult {
  deck: number;
  ok: boolean;
  txHash?: string;
  error?: string;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Liquida VARIOS mazos de una sola vez, lo más rápido posible: las tres
 * transacciones se firman y se envían seguidas (sin esperar recibo entre ellas)
 * y solo al final se esperan las confirmaciones en paralelo. Así el premio cae
 * en ~1 bloque en vez de en 3 rondas de ida y vuelta.
 *
 * El nonce se asigna a mano porque las tres salen de la MISMA cuenta: si se
 * dejara a viem pedirlo por RPC, los envíos casi simultáneos tomarían el mismo
 * número y dos de tres se caerían. Si un envío falla, su nonce NO se consume y
 * se reutiliza en el siguiente, para no dejar un hueco que atasque la cuenta.
 */
export async function settleDecks(
  entries: { deck: number; winner: string }[]
): Promise<SettleResult[]> {
  if (entries.length === 0) return [];
  const op = getOperator();
  if (!op) {
    return entries.map((e) => ({
      deck: e.deck,
      ok: false,
      error: "operator_not_configured",
    }));
  }

  let nonce: number;
  try {
    nonce = await op.pub.getTransactionCount({
      address: op.account.address,
      blockTag: "pending",
    });
  } catch (e) {
    return entries.map((entry) => ({
      deck: entry.deck,
      ok: false,
      error: errMsg(e, "nonce_read_failed"),
    }));
  }

  const failed: SettleResult[] = [];
  const sent: { deck: number; hash: Hash }[] = [];
  for (const entry of entries) {
    try {
      const hash = await op.wallet.writeContract({
        address: AVISPATE_POT_ADDRESS as `0x${string}`,
        abi: AVISPATE_POT_ABI,
        functionName: "settle",
        args: [entry.deck, entry.winner as `0x${string}`],
        nonce,
        gas: SETTLE_GAS,
      });
      nonce++;
      sent.push({ deck: entry.deck, hash: hash as Hash });
    } catch (e) {
      failed.push({
        deck: entry.deck,
        ok: false,
        error: errMsg(e, "settle_failed"),
      });
    }
  }

  const confirmed = await Promise.all(
    sent.map(async ({ deck, hash }): Promise<SettleResult> => {
      try {
        const receipt = await op.pub.waitForTransactionReceipt({ hash });
        return receipt.status === "success"
          ? { deck, ok: true, txHash: hash }
          : { deck, ok: false, txHash: hash, error: "settle_reverted" };
      } catch (e) {
        return { deck, ok: false, txHash: hash, error: errMsg(e, "receipt_failed") };
      }
    })
  );

  return [...confirmed, ...failed];
}
