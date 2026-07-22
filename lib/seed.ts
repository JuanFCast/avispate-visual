import {
  createPublicClient,
  createWalletClient,
  maxUint256,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";
import {
  AVISPATE_POT_ADDRESS,
  AVISPATE_POT_ABI,
  ERC20_ABI,
  USDT_CELO_ADDRESS,
} from "./contracts";

/** Cuánto sembrar por mazo cada ronda (1 USDT = 1000000, 6 decimales). */
export const SEED_AMOUNT = BigInt(
  process.env.AVISPATE_SEED_AMOUNT || "1000000"
);

/**
 * Cliente del Funder Rewards para sembrar los pozos. Clave SOLO en el servidor
 * (`FUNDER_PRIVATE_KEY`). Solo mueve fondos HACIA el pozo (seedPot).
 */
function getFunder() {
  const pk = process.env.FUNDER_PRIVATE_KEY;
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

export interface SeedResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/** Siembra el pozo de un mazo con SEED_AMOUNT desde el Funder. */
export async function seedPotFromFunder(deck: number): Promise<SeedResult> {
  const f = getFunder();
  if (!f) return { ok: false, error: "funder_not_configured" };
  const pot = AVISPATE_POT_ADDRESS as `0x${string}`;
  const usdt = USDT_CELO_ADDRESS as `0x${string}`;
  try {
    // Aprobar el pozo una vez (seedPot hace transferFrom del Funder).
    const allowance = (await f.pub.readContract({
      address: usdt,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [f.account.address, pot],
    })) as bigint;
    if (allowance < SEED_AMOUNT) {
      const approveHash = await f.wallet.writeContract({
        address: usdt,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [pot, maxUint256],
      });
      await f.pub.waitForTransactionReceipt({ hash: approveHash as Hash });
    }

    const hash = await f.wallet.writeContract({
      address: pot,
      abi: AVISPATE_POT_ABI,
      functionName: "seedPot",
      args: [deck, SEED_AMOUNT],
    });
    await f.pub.waitForTransactionReceipt({ hash: hash as Hash });
    return { ok: true, txHash: hash };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "seed_failed" };
  }
}
