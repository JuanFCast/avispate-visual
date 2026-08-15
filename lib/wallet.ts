"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount, type Connector } from "wagmi";
import { useProfile } from "./profile-context";
import type { CanonicalWallet } from "./pay-guard";
import {
  canonicalFromProfile,
  decideWalletIdentity,
  mayTransact,
  SETTLE_LIMIT_MS,
  waitingExpired,
  walletToShow,
  type WalletIdentityVerdict,
} from "./wallet-identity";

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
  /**
   * wagmi está reenganchando la wallet que ya estaba conectada (al recargar o
   * al volver a abrir). Todavía NO hay dirección, pero tampoco es un jugador
   * desconectado: es el mismo, un segundo antes de reaparecer.
   *
   * Sin distinguir este momento, la pantalla lo trataba como "sin wallet" y le
   * ofrecía volver a entrar durante ese parpadeo — que es exactamente lo que
   * los jugadores describen como "no me mantiene la sesión".
   */
  reconnecting: boolean;
  /** Nombre del conector activo (p. ej. "MetaMask" o "Avíspate (Privy)"). */
  connectorName: string;
  /**
   * El conector en sí. Se expone para poder PREGUNTARLE a la wallet por sus
   * cuentas antes de mover dinero (`lib/wallet-access.ts`), en vez de fiarse de
   * la dirección que wagmi tiene en memoria.
   */
  connector: Connector | undefined;
  /** Id de la red activa. */
  chainId: number | undefined;
}

/**
 * Wallet ACTIVA según wagmi: la que se usa para pagos, balances y premios. Es la
 * embebida de Privy por defecto (auto-conectada) o la externa que el usuario
 * conecte por RainbowKit. Siempre hay como máximo una activa.
 */
export function useActiveWallet(): ActiveWalletState {
  const { address, isConnected, connector, chainId, status } = useAccount();
  const enganchando = status === "reconnecting" || status === "connecting";

  /**
   * El reenganche CADUCA.
   *
   * wagmi guarda con qué conector estabas y lo reintenta al montar. Si ese
   * conector ya no puede existir, se queda en "reconnecting" para siempre — y
   * la pantalla, que trata ese estado como "espera, no le ofrezcas entrar", se
   * queda en "Preparando…" sin salida. Es lo que pasaba con sesión cerrada: la
   * wallet embebida solo se anuncia por EIP-6963 mientras hay sesión de Privy,
   * así que sin ella wagmi espera un proveedor que nadie va a anunciar.
   *
   * Pasado el tope se deja de esperar y la pantalla ofrece entrar. Si la wallet
   * aparece después, `isConnected` lo dice y todo sigue: equivocarse por este
   * lado se corrige solo, por el otro solo se corrige recargando.
   */
  const desde = useRef<number | null>(null);
  const [, setTick] = useState(0);

  if (enganchando && desde.current === null) desde.current = Date.now();
  if (!enganchando) desde.current = null;

  useEffect(() => {
    if (!enganchando) return;
    const t = setTimeout(() => setTick((n) => n + 1), SETTLE_LIMIT_MS + 100);
    return () => clearTimeout(t);
  }, [enganchando]);

  const reconnecting =
    enganchando && !waitingExpired(desde.current, Date.now());

  return {
    address: address ? address.toLowerCase() : "",
    isConnected,
    reconnecting,
    connectorName: connector?.name ?? "",
    connector,
    chainId,
  };
}

/**
 * La identidad de wallet del jugador, ya resuelta: canónica contra conectada.
 *
 * Es el único sitio del que deberían salir "qué dirección enseño" y "puede
 * operar". Antes cada pantalla elegía por su cuenta: las estadísticas venían del
 * perfil del servidor y la tarjeta de cartera de wagmi, así que una embebida
 * creada por accidente podía enseñar su saldo bajo el perfil de otra wallet.
 * La regla y su porqué están en `wallet-identity.ts`, que es puro y probado.
 */
export function useWalletIdentity(): {
  verdict: WalletIdentityVerdict;
  /** La que debe mirar la pantalla: saldos, cartera, premios. */
  shown: string | null;
  /** ¿Se puede firmar, pagar o cobrar ahora mismo? */
  canTransact: boolean;
  /** La del perfil, la que cobra. */
  canonical: string | null;
  /** Lo que wagmi tiene puesto. */
  connected: string | null;
} {
  const { walletAddress, ready: profileReady } = useProfile();
  const { address, isConnected, reconnecting } = useActiveWallet();

  // "Ya terminamos de mirar" es que el perfil llegó Y wagmi dejó de reengancharse.
  // Adelantarse a cualquiera de las dos haría parpadear un aviso de "conecta tu
  // cartera" a quien la tiene puesta.
  const verdict = decideWalletIdentity({
    canonical: walletAddress,
    connected: isConnected ? address : null,
    ready: profileReady && !reconnecting,
  });

  return {
    verdict,
    shown: walletToShow(verdict),
    canTransact: mayTransact(verdict),
    canonical: walletAddress,
    connected: isConnected ? address : null,
  };
}

/**
 * El perfil, traducido a los tres estados que el guardián de pago entiende.
 *
 * En un solo sitio a propósito: cada pantalla que lo dedujera por su cuenta
 * volvería a tener la oportunidad de confundir "todavía no lo sé" con "no hay",
 * que es el error que este tipo existe para hacer imposible.
 */
export function useCanonicalWallet(): CanonicalWallet {
  const {
    ready,
    loading,
    failed,
    authenticated,
    walletAddress,
    walletSessionAddress,
  } = useProfile();
  return canonicalFromProfile({
    ready,
    loading,
    failed,
    authenticated,
    walletAddress,
    walletSessionAddress,
  });
}

/** `0x1234…abcd`: dirección abreviada para mostrar en la UI. */
export function shortAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
