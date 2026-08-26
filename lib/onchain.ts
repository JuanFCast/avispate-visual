import { createPublicClient, parseEventLogs, type Hash } from "viem";
import { celo } from "viem/chains";
import { CELO_TRANSPORT } from "./chain";
import { probeTxPresence } from "./tx-probe";
import { AVISPATE_POT_ADDRESS, AVISPATE_POT_ABI } from "./contracts";
import { ARENA_ESCROW_ADDRESS } from "./arena-escrow";

/** Lo justo para reconocer el pago de una silla como prueba de identidad. */
const ARENA_JOINED_ABI = [
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
] as const;

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
    const jugadas = parseEventLogs({
      abi: AVISPATE_POT_ABI,
      eventName: "Played",
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === AVISPATE_POT_ADDRESS
      ),
    });

    /**
     * Pagar la entrada de una mesa TAMBIÉN prueba quién eres.
     *
     * Antes solo valía una jugada del reto diario, y eso obligaba a lo absurdo:
     * dentro de MiniPay había que jugar una partida individual antes de poder
     * entrar a una sala de la Arena. Lo dijo Juan probando: "voy a crear una
     * sala y tengo que jugar el reto individual".
     *
     * Y no hay ninguna razón para esa distinción. Lo que prueba el control de
     * una wallet es que firmó una transacción nuestra; que fuera una jugada o
     * una entrada da igual. La regla del escrow tampoco se toca: una sesión
     * abierta así sigue sin poder mover dinero — eso lo gobierna la ficha de la
     * silla, no la sesión.
     */
    const entradas = ARENA_ESCROW_ADDRESS
      ? parseEventLogs({
          abi: ARENA_JOINED_ABI,
          eventName: "Joined",
          logs: receipt.logs.filter(
            (l) => l.address.toLowerCase() === ARENA_ESCROW_ADDRESS
          ),
        })
      : [];

    const signed =
      jugadas.some(
        (l) => l.args.player.toLowerCase() === address.toLowerCase()
      ) ||
      entradas.some(
        (l) => (l.args.player as string).toLowerCase() === address.toLowerCase()
      );
    if (!signed) return false;

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const ageMs = now - Number(block.timestamp) * 1000;
    return ageMs >= 0 && ageMs <= MAX_TX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * En qué estado está el pago, con el detalle que hace falta para saber si la
 * jugada se conserva, se espera o se descarta.
 *
 * Antes todo esto era un `ok: false` y el endpoint lo traducía a
 * `invalid_payment`, un error reintentable: un hash que la red nunca vio se
 * quedaba 48 h en la bandeja del dispositivo, reintentándose contra la nada.
 */
export type PlayStatus =
  /** Minada, correcta y con su evento `Played`. */
  | "confirmed"
  /** Minada y revertida: no cobró la entrada ni gastó la jugada gratis. */
  | "reverted"
  /** Minada y correcta, pero sin un `Played` que corresponda a este mazo. */
  | "mined_no_event"
  /** La red la conoce y todavía no la mina. */
  | "pending"
  /** Con consenso de varios nodos: ese hash no existe. */
  | "unknown"
  /** No se pudo preguntar a la cadena. No se afirma nada. */
  | "unavailable";

export interface PlayVerification {
  ok: boolean;
  /** El detalle de por qué. `ok` es `status === "confirmed"`. */
  status?: PlayStatus;
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
  if (!AVISPATE_POT_ADDRESS) return { ok: false, status: "unavailable" };

  /**
   * Si no hay recibo, la pregunta cambia: ya no es "¿es válida?" sino
   * "¿existe?". Y esa se le hace a TODOS los nodos, porque uno solo atrasado
   * diciendo "no la tengo" es la situación normal de los primeros segundos.
   */
  const sinRecibo = async (): Promise<PlayVerification> => {
    const presencia = await probeTxPresence(txHash);
    switch (presencia) {
      case "pending":
        return { ok: false, status: "pending" };
      case "unknown":
        return { ok: false, status: "unknown" };
      // Otro nodo SÍ la tiene minada y el nuestro no pudo leerla: eso es un
      // tropiezo de lectura, no un veredicto. Se conserva y se reintenta.
      case "mined":
      case "unavailable":
        return { ok: false, status: "unavailable" };
    }
  };

  try {
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hash,
    });
    // Revirtió: el estado volvió atrás, así que no se cobró nada. Quien llama
    // puede cerrar ese pendiente y dejar jugar de nuevo sin cobrar dos veces.
    if (receipt.status !== "success") return { ok: false, status: "reverted" };

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
    // Minada y correcta, pero sin un `Played` de este mazo. Puede que la jugada
    // SÍ se haya cobrado con otro mazo, así que esto no autoriza a tirarla.
    if (!match) return { ok: false, status: "mined_no_event" };

    const player = match.args.player.toLowerCase();
    return {
      ok: true,
      status: "confirmed",
      player,
      deck: expectedDeck,
      wasFree: Boolean(match.args.wasFree),
      paidUnits: BigInt(match.args.toPot) + BigInt(match.args.commission),
      payerMismatch: player !== expectedPlayer.toLowerCase(),
    };
  } catch {
    /**
     * Aquí cae tanto "no hay recibo" (`TransactionReceiptNotFoundError`, que
     * viem lanza cuando el nodo devuelve nulo) como un fallo de lectura. Los
     * dos se resuelven igual: preguntándoles a todos los nodos, que es lo único
     * que distingue una transacción inexistente de una que no se pudo mirar.
     */
    try {
      return await sinRecibo();
    } catch {
      return { ok: false, status: "unavailable" };
    }
  }
}
