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

    // Igual que en `verifyPlayTx`: manda quién EMITE el evento, no a quién iba
    // dirigida la transacción. Sin este filtro, un contrato cualquiera podría
    // emitir un `Played` con la forma correcta y abrir sesión con él.
    const logs = parseEventLogs({
      abi: AVISPATE_POT_ABI,
      eventName: "Played",
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === AVISPATE_POT_ADDRESS
      ),
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
  /**
   * Quién pagó DE VERDAD, leído del evento del contrato (minúsculas). Es la
   * dirección que hay que usar: la que manda el cliente solo sirve para saber
   * si coincide.
   */
  player?: string;
  /** Mazo jugado si la verificación pasó. */
  deck?: number;
  /** La jugada consumió la gratis del día (según el evento del contrato). */
  wasFree?: boolean;
  /** Unidades que entraron al pozo + comisión. 0 en las gratis. */
  paidUnits?: bigint;
  /**
   * La cadena dice que pagó otra dirección distinta a la que afirmó el cliente.
   * `ok` sigue siendo true —la jugada existe y es válida—, pero quien llama NO
   * debe registrarla a nombre de nadie hasta reconciliar de quién es.
   */
  payerMismatch?: boolean;
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

    /**
     * Quién emitió el evento importa más que a quién iba dirigida la
     * transacción. Antes se exigía `receipt.to === contrato`, y eso hacía dos
     * cosas malas a la vez: dejaba fuera a cualquier wallet de contrato
     * inteligente (donde quien envía la transacción no es quien paga) y, aun
     * así, no comprobaba de qué contrato salía el `Played` — cualquiera puede
     * desplegar uno que emita un evento con la misma forma. Filtrar por la
     * dirección que EMITE el log es más estricto y además no discrimina cómo
     * llegó la llamada.
     */
    const logs = parseEventLogs({
      abi: AVISPATE_POT_ABI,
      eventName: "Played",
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === AVISPATE_POT_ADDRESS
      ),
    });

    // El mazo NO se negocia: una transacción del mazo de 10 no puede registrar
    // una partida de 20. Pero el jugador se LEE, no se exige.
    const match = logs.find((l) => Number(l.args.deck) === expectedDeck);
    if (!match) return { ok: false };

    const player = match.args.player.toLowerCase();
    return {
      ok: true,
      player,
      deck: expectedDeck,
      wasFree: Boolean(match.args.wasFree),
      paidUnits: BigInt(match.args.toPot) + BigInt(match.args.commission),
      payerMismatch: player !== expectedPlayer.toLowerCase(),
    };
  } catch {
    return { ok: false };
  }
}
