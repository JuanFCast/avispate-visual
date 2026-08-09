"use client";

import { useCallback } from "react";
import { celo } from "viem/chains";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import {
  AVISPATE_POT_ADDRESS,
  AVISPATE_POT_ABI,
  ERC20_ABI,
  USDT_CELO_ADDRESS,
  FEE_AMOUNT,
  APPROVE_UNITS,
  CIP64_FEE_ADAPTER,
} from "./contracts";
import { isMiniPay } from "./minipay";
import { confirmBeforeSigning, type PayDecision } from "./pay-guard";
import { probeWallet } from "./wallet-access";
import { useProfile } from "./profile-context";
import { ensureWalletSession } from "./wallet-session-client";
import type { MessageKey } from "./i18n";

/**
 * Gas que consume una jugada, con holgura.
 *
 * Medido sobre transacciones reales de Celo mainnet (`scripts/gas-cost.mjs`):
 * pagando en CELO, una `play()` paga gasta ~85.000 y una gratis ~32.000;
 * pagando la tarifa en USDT sube a ~154.000, porque cobrar en otro token
 * cuesta gas aparte. Se toma el caso peor.
 */
const PLAY_GAS_LIMIT = 150_000n;

/**
 * Cuánto de más se exige tener por encima del costo de UNA transacción antes
 * de dar el CELO por suficiente. El precio del gas se mueve entre que se lee y
 * que se firma; quedarse justo es quedarse corto.
 */
const GAS_SAFETY = 5n; // se divide entre 4 → x1.25

/**
 * Lo que RESERVA el botón "Máximo" al enviar USDT cuando la tarifa de red se
 * paga en USDT (CIP-64). Va holgado a propósito: mandar el saldo completo
 * revierte, porque la red cobra su tarifa del mismo token que se está enviando
 * y ya no queda con qué.
 */
export const GAS_MARGIN_USDT = 20_000n; // 0.02 USDT

/**
 * Lo MÍNIMO que se exige tener en USDT para dar por cubierta la tarifa de red.
 *
 * Medido sobre jugadas reales pagadas por CIP-64: ~0.0019 USDT cada una (el
 * adaptador cobra unos 150.000 de gas, más que en CELO porque el propio cobro
 * en otro token cuesta). Esto deja un margen de más del doble.
 *
 * Es más bajo que el margen de arriba, y a propósito: reservar de más al enviar
 * no le cuesta nada a nadie, pero exigir de más aquí sería negarle la partida a
 * quien sí podía pagarla.
 */
const MIN_USDT_FOR_FEE = 5_000n; // 0.005 USDT

/** Lo mínimo que necesitamos de un cliente público para decidir el gas. */
interface BalanceReader {
  getBalance: (args: { address: `0x${string}` }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
}

/**
 * Con qué se paga la tarifa de red de una transacción firmada por el jugador.
 *
 * En MiniPay SIEMPRE en USDT (su CELO es 0 por diseño). Fuera de MiniPay, se
 * paga en CELO mientras alcance, y en USDT (CIP-64) cuando no.
 *
 * "Cuando no alcance" se calcula con el precio del gas del momento, y ese es
 * el punto entero de esta función. Antes había un número fijo —0.01 CELO— que
 * venía de cuando el gas en Celo costaba unos pocos gwei. Hoy cuesta ~200, y
 * una jugada vale ~0.017 CELO: el umbral se quedó POR DEBAJO del precio de una
 * transacción. Eso abría una franja (entre 0.01 y 0.017) donde la app decidía
 * "tiene CELO de sobra", firmaba en CELO y la red la rechazaba por fondos
 * insuficientes — y como el saldo baja jugando, TODOS los jugadores de correo
 * caían en esa franja al gastar el regalo de bienvenida. Ahí nació el
 * "tenía USDT y me decía que no tenía".
 *
 * Vive aquí y no repetido en cada pantalla: jugar, enviar y cualquier firma
 * futura deben decidirlo igual, o un día una de ellas se queda sin con qué
 * pagar mientras las otras funcionan.
 */
export async function resolveFeeCurrency(
  publicClient: BalanceReader,
  address: `0x${string}`
): Promise<{ feeCurrency?: `0x${string}` }> {
  let payFeeInUsdt = isMiniPay();
  if (!payFeeInUsdt) {
    const [celoBalance, gasPrice] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.getGasPrice(),
    ]);
    const needed = (PLAY_GAS_LIMIT * gasPrice * GAS_SAFETY) / 4n;
    payFeeInUsdt = celoBalance < needed;
  }
  return payFeeInUsdt
    ? { feeCurrency: CIP64_FEE_ADAPTER as `0x${string}` }
    : {};
}

/**
 * Qué le falta a la wallet para poder jugar: la ENTRADA (USDT) o la TARIFA DE
 * RED (el gas). Son dos cosas distintas y confundirlas manda al jugador a
 * recargar lo que no era.
 *
 * Pasó de verdad: alguien con USDT de sobra veía "saldo insuficiente de USDT"
 * cuando lo que no tenía era CELO. El mensaje era el mismo para todo fallo que
 * dijera "insufficient", así que acusaba siempre al mismo token.
 */
export type MissingFunds = "entry" | "gas";

/** Error de saldo, con la carencia identificada para poder contarla bien. */
export class InsufficientFundsError extends Error {
  constructor(readonly missing: MissingFunds) {
    super(`insufficient_${missing}`);
    this.name = "InsufficientFundsError";
  }
}

/**
 * La wallet dejó de ser la que se validó, en mitad del cobro: se bloqueó, dejó
 * de responder o cambió de cuenta. Lleva la decisión de `pay-guard` para que la
 * pantalla sepa si toca reconectar o revalidar identidad, sin volver a
 * interpretar nada.
 */
export class WalletChangedError extends Error {
  constructor(readonly decision: PayDecision) {
    super(`wallet_${decision.kind}`);
    this.name = "WalletChangedError";
  }
}

/**
 * Qué le falta a la wallet para poder jugar, sabiendo su saldo de USDT y con
 * qué se va a pagar el gas. `null` = puede jugar.
 *
 * Comprobarlo ANTES de firmar no es solo cortesía: cuando el fallo llega de la
 * cadena, lo único que queda es un texto de error del que hay que adivinar qué
 * faltaba, y adivinar fue exactamente lo que salió mal.
 */
export function missingFundsFor(params: {
  /** El gas se cobra en USDT (CIP-64) porque la wallet no tiene CELO. */
  gasInUsdt: boolean;
  usdtBalance: bigint;
  /** La jugada cobra entrada (no es la gratis del día). */
  needsEntry: boolean;
}): MissingFunds | null {
  // Con CELO suficiente la tarifa está cubierta y solo queda mirar la entrada.
  const feeReserve = params.gasInUsdt ? MIN_USDT_FOR_FEE : 0n;
  // La tarifa en USDT sale del MISMO saldo que la entrada, así que se suman.
  if (params.gasInUsdt && params.usdtBalance < feeReserve) return "gas";
  if (params.needsEntry && params.usdtBalance < FEE_AMOUNT + feeReserve) {
    return "entry";
  }
  return null;
}

/**
 * Paso visible del flujo de jugada. Existe para que el botón cuente lo que
 * está pasando sin tapar el lobby: cada valor es un texto de botón, no un
 * estado del contrato. `starting` no lo emite este hook — lo pone la pantalla
 * cuando la transacción ya está confirmada y solo falta repartir.
 */
export type PlayStage =
  | "checking"
  | "switching"
  | "confirm"
  | "approving"
  | "confirming"
  | "registering"
  | "starting";

export const PLAY_STAGE_KEY: Record<PlayStage, MessageKey> = {
  // Antes de firmar nada: comprobar que el puntaje se va a poder guardar.
  checking: "stage.checking",
  switching: "stage.switching",
  confirm: "stage.confirm",
  approving: "stage.approving",
  // Dos pasos distintos con dos textos distintos: esperar a que la cadena
  // confirme no es lo mismo que avisarle al servidor, y cuando algo se cuelga
  // hay que poder saber cuál de los dos fue.
  confirming: "stage.confirming",
  registering: "stage.registering",
  starting: "stage.starting",
};

/**
 * Cuánto se espera a que la transacción aparezca confirmada en la cadena.
 *
 * El valor por defecto de viem son 180 s (tres minutos mirando un spinner).
 * En Celo un bloque tarda ~1 s: si a los 20 s no se ve, no es que la
 * transacción vaya a fallar, es que el sondeo se tropezó — típico dentro de
 * MiniPay, cuya webview se suspende mientras muestra la hoja de firma.
 */
const RECEIPT_TIMEOUT_MS = 20_000;

export interface PlayResult {
  /** Hash de la transacción `play(deck)` confirmada. */
  txHash: string;
  /** Wallet que jugó (minúsculas). */
  player: string;
  /** La transacción consumió la jugada gratis del día (según el contrato). */
  wasFree: boolean;
}

/**
 * Toda jugada pasa por aquí: llama `play(deck)` en el contrato con la wallet
 * ACTIVA de wagmi y espera confirmación. El contrato decide gratis vs paga
 * (`hasFreePlayToday`); para las pagas asegura antes un allowance ACOTADO de
 * USDT (varias jugadas, nunca ilimitado: MiniPay rechaza maxUint256). El
 * txHash devuelto es la prueba de identidad que verifica el backend.
 *
 * `onStage` es solo para la UI: avisa en qué paso va sin cambiar el flujo.
 */
export function usePayToPlay() {
  const { address, chainId, connector } = useAccount();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  /** La wallet del perfil: la que cobra, y por tanto la única que puede firmar. */
  const { walletAddress: canonical } = useProfile();

  const playForDeck = useCallback(
    async (
      deck: number,
      onStage: (stage: PlayStage) => void = () => {},
      /**
       * Dirección ya confirmada contra la wallet y ya validada como identidad.
       * Se pasa en vez de leerla de wagmi porque la de wagmi es memoria del
       * navegador: TODO el cobro (gratis o paga, saldo, permiso y firma) tiene
       * que construirse sobre la misma dirección que se comprobó.
       */
      confirmedAddress?: string
    ): Promise<PlayResult> => {
      const account = (confirmedAddress || address) as `0x${string}` | undefined;
      if (!account) throw new Error("no_wallet");
      if (!AVISPATE_POT_ADDRESS) throw new Error("pot_not_configured");
      if (!publicClient) throw new Error("no_client");

      /**
       * Última comprobación, pegada a cada firma.
       *
       * Entre validar la identidad y firmar pasan segundos y varias lecturas de
       * la cadena: tiempo de sobra para cambiar de cuenta en la extensión o
       * para que se bloquee sola. Si eso ocurre, firmar sería cobrarle a una
       * dirección y anotarle la partida a otra.
       */
      const assertSameAccount = async () => {
        const probe = await probeWallet(connector);
        // Se re-exige también la wallet del perfil: entre la comprobación de
        // arriba y esta firma cabe un cambio a una cuenta que no es la que
        // cobra, y firmar con ella dejaría el pago a nombre de otra identidad.
        const verdict = confirmBeforeSigning(account, probe, canonical);
        if (!verdict.ok) throw new WalletChangedError(verdict.decision);
      };

      // Asegurar que estamos en Celo antes de firmar.
      if (chainId !== celo.id) {
        onStage("switching");
        await switchChainAsync({ chainId: celo.id });
      }

      // A partir de aquí todo termina en una firma: las lecturas previas son
      // instantáneas al lado de lo que tarda el jugador en confirmar.
      onStage("confirm");

      const pot = AVISPATE_POT_ADDRESS as `0x${string}`;
      const usdt = USDT_CELO_ADDRESS as `0x${string}`;

      // La fuente de verdad de gratis/paga es el contrato, leída justo antes
      // de firmar (no el estado de la UI, que puede estar desactualizado).
      const wasFree = (await publicClient.readContract({
        address: pot,
        abi: AVISPATE_POT_ABI,
        functionName: "hasFreePlayToday",
        args: [deck, account],
      })) as boolean;

      const feeCurrency = await resolveFeeCurrency(publicClient, account);

      // Saldo antes de la firma: si algo falta, se dice CUÁL falta en vez de
      // mandar al jugador a una transacción que va a revertir. Si el saldo no
      // se puede leer no se bloquea a nadie — que decida la cadena.
      try {
        const usdtBalance = (await publicClient.readContract({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account],
        })) as bigint;
        const missing = missingFundsFor({
          gasInUsdt: Boolean(feeCurrency.feeCurrency),
          usdtBalance,
          needsEntry: !wasFree,
        });
        if (missing) throw new InsufficientFundsError(missing);
      } catch (err) {
        if (err instanceof InsufficientFundsError) throw err;
      }

      // Allowance solo para jugadas pagas: la gratis no mueve USDT.
      if (!wasFree) {
        const allowance = (await publicClient.readContract({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account, pot],
        })) as bigint;

        if (allowance < FEE_AMOUNT) {
          // Monto acotado (varias jugadas). "Approve una vez, luego jugar":
          // el patrón que MiniPay exige; se repone cuando baja de una entrada.
          await assertSameAccount();
          const approveHash = await writeContractAsync({
            account,
            address: usdt,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [pot, APPROVE_UNITS],
            chainId: celo.id,
            ...feeCurrency,
          });
          onStage("approving");
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          // Falta la firma de la jugada: vuelve a tocarle al jugador.
          onStage("confirm");
        }
      }

      // La comprobación que de verdad importa: la de la firma que cobra.
      await assertSameAccount();
      const playHash = await writeContractAsync({
        // `account` explícito: wagmi firma con ESTA dirección o falla. Sin él
        // usaría la que tenga guardada, que es justo de la que desconfiamos.
        account,
        address: pot,
        abi: AVISPATE_POT_ABI,
        functionName: "play",
        args: [deck],
        chainId: celo.id,
        ...feeCurrency,
      });
      // Con el hash en la mano, la wallet YA transmitió la transacción: el
      // contrato consumió la jugada gratis o cobró la entrada, pase lo que
      // pase de aquí en adelante. Por eso esta espera tiene tope y su fracaso
      // NO cancela la jugada: tratarla como error le quitaría al jugador algo
      // que la cadena ya le cobró. El servidor vuelve a verificar el hash de
      // todos modos antes de aceptar nada.
      onStage("confirming");
      try {
        await publicClient.waitForTransactionReceipt({
          hash: playHash,
          timeout: RECEIPT_TIMEOUT_MS,
        });
      } catch {
        // Sigue adelante con el hash; el registro en el servidor decide.
      }

      // Con la jugada confirmada, esa transacción es prueba de que la wallet es
      // suya, así que sirve para abrir sesión donde no se puede firmar un
      // mensaje (MiniPay). Va aquí y no en cada pantalla por lo mismo que
      // `resolveFeeCurrency`: es de toda jugada, no de una. No se espera ni se
      // comprueba —quien ya tiene sesión no gasta nada y un fallo no puede
      // tocar el resultado de la partida.
      void ensureWalletSession(account, playHash);

      return { txHash: playHash, player: account.toLowerCase(), wasFree };
    },
    [address, connector, chainId, publicClient, writeContractAsync, switchChainAsync]
  );

  return {
    playForDeck,
    canPlay: Boolean(address) && Boolean(AVISPATE_POT_ADDRESS),
  };
}
