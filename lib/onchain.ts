import { createPublicClient, parseEventLogs, type Hash } from "viem";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";
import { AVISPATE_POT_ADDRESS, AVISPATE_POT_ABI } from "./contracts";

// Cliente de solo lectura de Celo (reusa el transporte con failover).
const client = createPublicClient({ chain: celo, transport: CELO_TRANSPORT });

export interface PlayVerification {
  ok: boolean;
  /** Dirección del jugador (minúsculas) si la verificación pasó. */
  player?: string;
  /** Mazo jugado si la verificación pasó. */
  deck?: number;
}

/**
 * Verifica ON-CHAIN que `txHash` es una jugada `play(deck)` confirmada del
 * `expectedPlayer` en el contrato AvispatePot. El pago on-chain es la prueba de
 * identidad: no confiamos en la dirección que envía el cliente sin este cheque.
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
    };
  } catch {
    return { ok: false };
  }
}
