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
 * Gas fijo para `seedPot`. NO se deja estimar: la siembra corre pisándole los
 * talones a `settle`, y viem estimaría contra un estado que la propia tanda
 * está a punto de invalidar. Con el pozo todavía lleno, escribir `pot[deck]`
 * es un SSTORE de 5.000 gas; una vez que `settle` lo pone en cero, el mismo
 * SSTORE cuesta 20.000 (y lo mismo el saldo USDT del contrato si quedó vacío).
 * Esa diferencia se comió la siembra del mazo 10 el 2026-08-04: límite 64.299,
 * consumido 63.298, revertida por gas. El sobrante no se cobra, así que el
 * colchón sale gratis.
 */
const SEED_GAS = 150_000n;

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
  deck: number;
  ok: boolean;
  txHash?: string;
  error?: string;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Siembra VARIOS pozos de una sola vez. Mismo patrón que `settleDecks`: envíos
 * seguidos con nonce propio (todas salen del Funder) y confirmaciones en
 * paralelo, para no encadenar tres esperas de bloque.
 */
export async function seedPots(decks: number[]): Promise<SeedResult[]> {
  if (decks.length === 0) return [];
  const f = getFunder();
  if (!f) {
    return decks.map((deck) => ({
      deck,
      ok: false,
      error: "funder_not_configured",
    }));
  }
  const pot = AVISPATE_POT_ADDRESS as `0x${string}`;
  const usdt = USDT_CELO_ADDRESS as `0x${string}`;

  let nonce: number;
  try {
    // Aprobar el pozo una vez (seedPot hace transferFrom del Funder). Esto sí
    // va antes y confirmado: sin allowance, las siembras revertirían.
    const allowance = (await f.pub.readContract({
      address: usdt,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [f.account.address, pot],
    })) as bigint;
    if (allowance < SEED_AMOUNT * BigInt(decks.length)) {
      const approveHash = await f.wallet.writeContract({
        address: usdt,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [pot, maxUint256],
      });
      await f.pub.waitForTransactionReceipt({ hash: approveHash as Hash });
    }
    nonce = await f.pub.getTransactionCount({
      address: f.account.address,
      blockTag: "pending",
    });
  } catch (e) {
    return decks.map((deck) => ({
      deck,
      ok: false,
      error: errMsg(e, "seed_prepare_failed"),
    }));
  }

  const failed: SeedResult[] = [];
  const sent: { deck: number; hash: Hash }[] = [];
  for (const deck of decks) {
    try {
      const hash = await f.wallet.writeContract({
        address: pot,
        abi: AVISPATE_POT_ABI,
        functionName: "seedPot",
        args: [deck, SEED_AMOUNT],
        nonce,
        gas: SEED_GAS,
      });
      nonce++;
      sent.push({ deck, hash: hash as Hash });
    } catch (e) {
      failed.push({ deck, ok: false, error: errMsg(e, "seed_failed") });
    }
  }

  const confirmed = await Promise.all(
    sent.map(async ({ deck, hash }): Promise<SeedResult> => {
      try {
        const receipt = await f.pub.waitForTransactionReceipt({ hash });
        return receipt.status === "success"
          ? { deck, ok: true, txHash: hash }
          : { deck, ok: false, txHash: hash, error: "seed_reverted" };
      } catch (e) {
        return { deck, ok: false, txHash: hash, error: errMsg(e, "receipt_failed") };
      }
    })
  );

  return [...confirmed, ...failed];
}
