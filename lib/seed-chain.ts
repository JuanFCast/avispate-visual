/**
 * La parte del sembrador que firma: cliente del Funder Rewards y las tres
 * dependencias de cadena que consume `seedToFloor`.
 *
 * Vive aparte de `seed-floor.ts` para que el robot se pueda probar con `node`
 * sin arrastrar viem, y para que la clave del Funder solo se lea desde aquí.
 */

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
import type { SeedDeps, SendResult } from "./seed-floor";

/**
 * Gas fijo para `seedPot`. NO se deja estimar: escribir `pot[deck]` sobre un
 * pozo vacío es un SSTORE de 20.000 gas y sobre uno con saldo son 5.000, y la
 * estimación no siempre ve el caro. Esa diferencia se comió la siembra del mazo
 * 10 el 2026-08-04 (límite 64.299, consumido 63.298, revertida por gas). El
 * sobrante no se cobra, así que el colchón sale gratis.
 */
const SEED_GAS = 150_000n;

/**
 * Cuántas veces se reintenta una transacción antes de rendirse, y cuánto se
 * espera entre intentos. Tres y 2,5 s: lo justo para que un choque de nonce se
 * resuelva sin comerse el presupuesto de la función (ver BUDGET_MS en la ruta).
 * Rendirse aquí no pierde nada — la corrida de la hora siguiente lo recoge.
 */
const SEND_ATTEMPTS = 3;
const RETRY_WAIT_MS = 2500;

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Cliente del Funder Rewards. La clave vive SOLO en el servidor
 * (`FUNDER_PRIVATE_KEY`) y desde aquí solo mueve fondos HACIA el pozo.
 *
 * Esta wallet DEBERÍA ser exclusiva de la siembra de Avíspate. La que se usó
 * hasta el 2026-08-16 (0x46d5F9fE) no lo era: en 40 días tocó 17 contratos —
 * sembraba también TypeRush V2 y V3, entraba a Arena y era además el teléfono
 * con el que se juega. Cuatro robots y una persona compartiendo una secuencia
 * de nonce es lo que dejó los pozos en cero, y no hay horario de cron que
 * coordine eso. El código no distingue qué llave es: separar la wallet es
 * cambiar esta variable de entorno y nada más.
 */
function getFunder() {
  const pk = process.env.FUNDER_PRIVATE_KEY;
  if (!pk || !AVISPATE_POT_ADDRESS) return null;
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`
  );
  return {
    account,
    wallet: createWalletClient({
      account,
      chain: celo,
      transport: CELO_TRANSPORT,
    }),
    pub: createPublicClient({ chain: celo, transport: CELO_TRANSPORT }),
  };
}

/** ¿Hay con qué sembrar? La ruta contesta 503 en vez de fingir que sembró. */
export function isSeedConfigured(): boolean {
  return Boolean(process.env.FUNDER_PRIVATE_KEY && AVISPATE_POT_ADDRESS);
}

/**
 * Las dependencias de cadena de verdad.
 *
 * `sendSeed` reintenta pidiendo un nonce FRESCO en cada vuelta, y ese es el
 * arreglo directo del fallo del 16 de agosto: el choque de nonce con el
 * sembrador de TypeRush (la misma wallet Funder sirve a los dos juegos)
 * devolvía un error de envío y nadie reintentaba.
 */
export function chainDeps(): Pick<
  SeedDeps,
  "readPot" | "readFunder" | "sendSeed"
> {
  const pot = AVISPATE_POT_ADDRESS as `0x${string}`;
  const usdt = USDT_CELO_ADDRESS as `0x${string}`;

  return {
    async readPot(deck) {
      const f = getFunder();
      if (!f) throw new Error("funder_not_configured");
      return (await f.pub.readContract({
        address: pot,
        abi: AVISPATE_POT_ABI,
        functionName: "pot",
        args: [deck],
      })) as bigint;
    },

    async readFunder() {
      const f = getFunder();
      if (!f) throw new Error("funder_not_configured");
      const [balance, allowance] = await Promise.all([
        f.pub.readContract({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [f.account.address],
        }) as Promise<bigint>,
        f.pub.readContract({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [f.account.address, pot],
        }) as Promise<bigint>,
      ]);
      return { address: f.account.address, balance, allowance };
    },

    async sendSeed(deck, amount) {
      const f = getFunder();
      if (!f) return { ok: false, error: "funder_not_configured" };

      let last = "seed_failed";
      for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
        try {
          // Nonce fresco en CADA intento: si otro proceso de la misma wallet se
          // llevó el que teníamos, el reintento coge el siguiente y entra.
          const nonce = await f.pub.getTransactionCount({
            address: f.account.address,
            blockTag: "pending",
          });
          const hash = (await f.wallet.writeContract({
            address: pot,
            abi: AVISPATE_POT_ABI,
            functionName: "seedPot",
            args: [deck, amount],
            nonce,
            gas: SEED_GAS,
          })) as Hash;
          const receipt = await f.pub.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            // Revertida es distinto de no-enviada: reintentar no la va a
            // arreglar y el pozo NO se movió. Se informa y se sale.
            return { ok: false, txHash: hash, error: "seed_reverted" };
          }
          return { ok: true, txHash: hash };
        } catch (e) {
          last = errMsg(e, "seed_failed");
          if (attempt < SEND_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
          }
        }
      }
      return { ok: false, error: last };
    },
  };
}

/**
 * Deja al Funder aprobado frente al pozo. Se llama a mano desde el CLI: la ruta
 * del cron NO aprueba, para que un robot horario no pueda firmar una
 * autorización si algún día alguien le cambia el contrato debajo.
 */
export async function approveFunder(): Promise<SendResult> {
  const f = getFunder();
  if (!f) return { ok: false, error: "funder_not_configured" };
  try {
    const hash = (await f.wallet.writeContract({
      address: USDT_CELO_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [AVISPATE_POT_ADDRESS as `0x${string}`, maxUint256],
    })) as Hash;
    const receipt = await f.pub.waitForTransactionReceipt({ hash });
    return receipt.status === "success"
      ? { ok: true, txHash: hash }
      : { ok: false, txHash: hash, error: "approve_reverted" };
  } catch (e) {
    return { ok: false, error: errMsg(e, "approve_failed") };
  }
}
