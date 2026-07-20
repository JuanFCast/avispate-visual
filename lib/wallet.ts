"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";

export interface EmbeddedWalletState {
  /** Privy terminó de hidratar el estado de sesión. */
  ready: boolean;
  /** El usuario tiene sesión iniciada. */
  authenticated: boolean;
  /** Dirección EVM de la wallet embebida de Privy, o "" si aún no existe. */
  address: string;
}

/**
 * Estado de la wallet embebida de Privy. La wallet embebida es la que Privy
 * crea automáticamente al iniciar sesión (`createOnLogin`); se distingue del
 * resto por `walletClientType === "privy"`.
 */
export function useEmbeddedWallet(): EmbeddedWalletState {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  return {
    ready,
    authenticated,
    address: embedded?.address ?? "",
  };
}

/** `0x1234…abcd`: dirección abreviada para mostrar en la UI. */
export function shortAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
