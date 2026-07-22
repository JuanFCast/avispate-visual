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

export interface SettleResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/** Liquida el pozo de un mazo al ganador (firma el Operator). */
export async function settleDeck(
  deck: number,
  winner: string
): Promise<SettleResult> {
  const op = getOperator();
  if (!op) return { ok: false, error: "operator_not_configured" };
  try {
    const hash = await op.wallet.writeContract({
      address: AVISPATE_POT_ADDRESS as `0x${string}`,
      abi: AVISPATE_POT_ABI,
      functionName: "settle",
      args: [deck, winner as `0x${string}`],
    });
    await op.pub.waitForTransactionReceipt({ hash: hash as Hash });
    return { ok: true, txHash: hash };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "settle_failed" };
  }
}
