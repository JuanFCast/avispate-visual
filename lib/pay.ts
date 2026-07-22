"use client";

import { useCallback } from "react";
import { maxUint256 } from "viem";
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
} from "./contracts";

export interface PayResult {
  /** Hash de la transacción `play(deck)` confirmada. */
  txHash: string;
  /** Wallet que pagó (minúsculas). */
  player: string;
}

/**
 * Pago de una jugada: asegura allowance de USDT (approve una sola vez) y llama
 * `play(deck)` en el contrato, esperando la confirmación. Devuelve el txHash que
 * el backend verifica on-chain. Usa la wallet ACTIVA de wagmi.
 */
export function usePayToPlay() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const payForDeck = useCallback(
    async (deck: number): Promise<PayResult> => {
      if (!address) throw new Error("no_wallet");
      if (!AVISPATE_POT_ADDRESS) throw new Error("pot_not_configured");
      if (!publicClient) throw new Error("no_client");

      // Asegurar que estamos en Celo antes de firmar.
      if (chainId !== celo.id) {
        await switchChainAsync({ chainId: celo.id });
      }

      const pot = AVISPATE_POT_ADDRESS as `0x${string}`;
      const usdt = USDT_CELO_ADDRESS as `0x${string}`;

      // 1. Allowance: aprobar el contrato una vez (máximo) si hace falta.
      const allowance = (await publicClient.readContract({
        address: usdt,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, pot],
      })) as bigint;

      if (allowance < FEE_AMOUNT) {
        const approveHash = await writeContractAsync({
          address: usdt,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [pot, maxUint256],
          chainId: celo.id,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2. Pagar la jugada.
      const playHash = await writeContractAsync({
        address: pot,
        abi: AVISPATE_POT_ABI,
        functionName: "play",
        args: [deck],
        chainId: celo.id,
      });
      await publicClient.waitForTransactionReceipt({ hash: playHash });

      return { txHash: playHash, player: address.toLowerCase() };
    },
    [address, chainId, publicClient, writeContractAsync, switchChainAsync]
  );

  return {
    payForDeck,
    canPay: Boolean(address) && Boolean(AVISPATE_POT_ADDRESS),
  };
}
