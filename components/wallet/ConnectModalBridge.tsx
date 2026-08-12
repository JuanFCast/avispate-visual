"use client";

import { useEffect } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";

/**
 * El ÚNICO sitio que llama a `useConnectModal` de RainbowKit en la portada.
 *
 * Antes `GameShell` y `HomeLobby` llamaban al hook cada uno por su cuenta, así
 * que el modal de conectar wallets —MetaMask, Coinbase, WalletConnect, el
 * catálogo entero— viajaba en la carga inicial de CUALQUIERA que abriera
 * avispate.fun, MiniPay incluido, donde ese botón no existe (la wallet
 * inyectada ya se conectó sola, `useMiniPayAutoConnect`).
 *
 * Este puente se monta con `next/dynamic({ ssr: false })` y SOLO cuando
 * `!isMiniPay()`, así que su código —y el de RainbowKit que arrastra— ni
 * siquiera se pide de la red para un jugador de MiniPay. No reemplaza nada
 * de la identidad ni del guardián de pago: solo entrega la función que abre
 * el modal a quien la necesite, por `onReady`.
 */
export default function ConnectModalBridge({
  onReady,
}: {
  onReady: (open: () => void) => void;
}) {
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    if (openConnectModal) onReady(openConnectModal);
  }, [openConnectModal, onReady]);

  return null;
}
