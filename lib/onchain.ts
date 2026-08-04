import { createPublicClient, parseEventLogs, type Hash } from "viem";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";
import { AVISPATE_POT_ADDRESS, AVISPATE_POT_ABI } from "./contracts";

// Cliente de solo lectura de Celo (reusa el transporte con failover).
const client = createPublicClient({ chain: celo, transport: CELO_TRANSPORT });

/**
 * Ventana en la que un txHash sirve para abrir sesión de wallet. Los hashes son
 * públicos apenas se minan, así que cuanto más corta, menos sirve robarlos; pero
 * tiene que aguantar que la webview de MiniPay se suspenda mostrando la hoja de
 * firma y vuelva unos segundos después.
 */
const MAX_TX_AGE_MS = 5 * 60 * 1000;

/**
 * Verifica que `txHash` es una jugada del contrato firmada por `address` y lo
 * bastante reciente como para abrir sesión. Es la prueba de control de la
 * wallet que reemplaza a `personal_sign` dentro de MiniPay (ver
 * `wallet-session.ts`): no mira el mazo, solo quién firmó y cuándo.
 */
export async function verifyWalletControl(
  txHash: string,
  address: string,
  now = Date.now()
): Promise<boolean> {
  if (!AVISPATE_POT_ADDRESS) return false;
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
    if (receipt.status !== "success") return false;
    if (receipt.to?.toLowerCase() !== AVISPATE_POT_ADDRESS) return false;

    const logs = parseEventLogs({
      abi: AVISPATE_POT_ABI,
      eventName: "Played",
      logs: receipt.logs,
    });
    const signed = logs.some(
      (l) => l.args.player.toLowerCase() === address.toLowerCase()
    );
    if (!signed) return false;

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const ageMs = now - Number(block.timestamp) * 1000;
    return ageMs >= 0 && ageMs <= MAX_TX_AGE_MS;
  } catch {
    return false;
  }
}

export interface PlayVerification {
  ok: boolean;
  /** Dirección del jugador (minúsculas) si la verificación pasó. */
  player?: string;
  /** Mazo jugado si la verificación pasó. */
  deck?: number;
  /** La jugada consumió la gratis del día (según el evento del contrato). */
  wasFree?: boolean;
}

/**
 * Verifica ON-CHAIN que `txHash` es una jugada `play(deck)` confirmada del
 * `expectedPlayer` en el contrato AvispatePot, y si fue gratis o paga. La
 * transacción es la prueba de identidad de TODAS las jugadas: no confiamos en
 * la dirección que envía el cliente sin este cheque.
 */
export async function verifyPlayTx(
  txHash: string,
  expectedPlayer: string,
  expectedDeck: number
): Promise<PlayVerification> {
  if (!AVISPATE_POT_ADDRESS) return { ok: false };
  try {
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hash,
    });
    if (receipt.status !== "success") return { ok: false };
    if (receipt.to?.toLowerCase() !== AVISPATE_POT_ADDRESS) return { ok: false };

    const logs = parseEventLogs({
      abi: AVISPATE_POT_ABI,
      eventName: "Played",
      logs: receipt.logs,
    });
    const match = logs.find(
      (l) =>
        l.args.player.toLowerCase() === expectedPlayer.toLowerCase() &&
        Number(l.args.deck) === expectedDeck
    );
    if (!match) return { ok: false };

    return {
      ok: true,
      player: expectedPlayer.toLowerCase(),
      deck: expectedDeck,
      wasFree: Boolean(match.args.wasFree),
    };
  } catch {
    return { ok: false };
  }
}
