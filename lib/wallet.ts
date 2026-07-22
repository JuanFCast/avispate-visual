"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

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

export interface ActiveWalletState {
  /** Dirección de la wallet ACTIVA en wagmi (embebida o externa), en minúsculas. */
  address: string;
  /** Hay una wallet conectada en wagmi. */
  isConnected: boolean;
  /** Nombre del conector activo (p. ej. "MetaMask" o "Avíspate (Privy)"). */
  connectorName: string;
  /** Id de la red activa. */
  chainId: number | undefined;
}

/**
 * Wallet ACTIVA según wagmi: la que se usa para pagos, balances y premios. Es la
 * embebida de Privy por defecto (auto-conectada) o la externa que el usuario
 * conecte por RainbowKit. Siempre hay como máximo una activa.
 */
export function useActiveWallet(): ActiveWalletState {
  const { address, isConnected, connector, chainId } = useAccount();
  return {
    address: address ? address.toLowerCase() : "",
    isConnected,
    connectorName: connector?.name ?? "",
    chainId,
  };
}

/** `0x1234…abcd`: dirección abreviada para mostrar en la UI. */
export function shortAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
