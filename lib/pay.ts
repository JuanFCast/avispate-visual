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
 */
export function usePayToPlay() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const playForDeck = useCallback(
    async (deck: number): Promise<PlayResult> => {
      if (!address) throw new Error("no_wallet");
      if (!AVISPATE_POT_ADDRESS) throw new Error("pot_not_configured");
      if (!publicClient) throw new Error("no_client");

      // Asegurar que estamos en Celo antes de firmar.
      if (chainId !== celo.id) {
        await switchChainAsync({ chainId: celo.id });
      }

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

      // CIP-64: en MiniPay SIEMPRE (su CELO es 0 por diseño; el gas sale del
      // USDT). Fuera de MiniPay, solo si la wallet casi no tiene CELO.
      let payGasInUsdt = isMiniPay();
      if (!payGasInUsdt) {
        const celoBalance = await publicClient.getBalance({ address });
        payGasInUsdt = celoBalance < MIN_CELO_FOR_GAS;
      }
      const feeCurrency = payGasInUsdt
        ? { feeCurrency: CIP64_FEE_ADAPTER as `0x${string}` }
        : {};

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
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
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
