"use client";

import { useCallback } from "react";
import { parseEther } from "viem";
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

// Umbral de CELO por debajo del cual pagamos el gas en USDT (CIP-64). Las
// wallets embebidas de Privy y MiniPay suelen tener 0 CELO.
const MIN_CELO_FOR_GAS = parseEther("0.01");

/** Lo mínimo que necesitamos de un cliente público para decidir el gas. */
interface BalanceReader {
  getBalance: (args: { address: `0x${string}` }) => Promise<bigint>;
}

/**
 * Con qué se paga el gas de una transacción firmada por el jugador.
 *
 * En MiniPay SIEMPRE en USDT (su CELO es 0 por diseño). Fuera de MiniPay,
 * solo si la wallet casi no tiene CELO. Vive aquí y no repetido en cada
 * pantalla: jugar, enviar y cualquier firma futura deben decidirlo igual, o
 * un día una de ellas se queda sin gas mientras las otras funcionan.
 */
export async function resolveFeeCurrency(
  publicClient: BalanceReader,
  address: `0x${string}`
): Promise<{ feeCurrency?: `0x${string}` }> {
  let payGasInUsdt = isMiniPay();
  if (!payGasInUsdt) {
    const celoBalance = await publicClient.getBalance({ address });
    payGasInUsdt = celoBalance < MIN_CELO_FOR_GAS;
  }
  return payGasInUsdt
    ? { feeCurrency: CIP64_FEE_ADAPTER as `0x${string}` }
    : {};
}

/**
 * Paso visible del flujo de jugada. Existe para que el botón cuente lo que
 * está pasando sin tapar el lobby: cada valor es un texto de botón, no un
 * estado del contrato. `starting` no lo emite este hook — lo pone la pantalla
 * cuando la transacción ya está confirmada y solo falta repartir.
 */
export type PlayStage =
  | "switching"
  | "confirm"
  | "approving"
  | "registering"
  | "starting";

export const PLAY_STAGE_LABEL: Record<PlayStage, string> = {
  switching: "Cambiando a Celo…",
  confirm: "Confirma en tu wallet…",
  approving: "Autorizando USDT…",
  registering: "Registrando jugada…",
  starting: "Preparando partida…",
};

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
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const playForDeck = useCallback(
    async (
      deck: number,
      onStage: (stage: PlayStage) => void = () => {}
    ): Promise<PlayResult> => {
      if (!address) throw new Error("no_wallet");
      if (!AVISPATE_POT_ADDRESS) throw new Error("pot_not_configured");
      if (!publicClient) throw new Error("no_client");

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
        args: [deck, address],
      })) as boolean;

      const feeCurrency = await resolveFeeCurrency(publicClient, address);

      // Allowance solo para jugadas pagas: la gratis no mueve USDT.
      if (!wasFree) {
        const allowance = (await publicClient.readContract({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, pot],
        })) as bigint;

        if (allowance < FEE_AMOUNT) {
          // Monto acotado (varias jugadas). "Approve una vez, luego jugar":
          // el patrón que MiniPay exige; se repone cuando baja de una entrada.
          const approveHash = await writeContractAsync({
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

      const playHash = await writeContractAsync({
        address: pot,
        abi: AVISPATE_POT_ABI,
        functionName: "play",
        args: [deck],
        chainId: celo.id,
        ...feeCurrency,
      });
      onStage("registering");
      await publicClient.waitForTransactionReceipt({ hash: playHash });

      return { txHash: playHash, player: address.toLowerCase(), wasFree };
    },
    [address, chainId, publicClient, writeContractAsync, switchChainAsync]
  );

  return {
    playForDeck,
    canPlay: Boolean(address) && Boolean(AVISPATE_POT_ADDRESS),
  };
}
