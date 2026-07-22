"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import { useEffect, useRef, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useConnect } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./wagmi";
import { useMiniPayAutoConnect } from "./minipay";
import { ProfileProvider } from "./profile-context";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

const queryClient = new QueryClient();

// Identidad EIP-6963 con la que anunciamos la wallet embebida a wagmi/RainbowKit.
const EMBEDDED_INFO = {
  name: "Avíspate (Privy)",
  rdns: "fun.avispate.embedded",
  icon:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23FFC20E'/%3E%3C/svg%3E",
};

/**
 * Puente Privy → wagmi. Hace dos cosas:
 *   1. Anuncia la wallet embebida de Privy por EIP-6963 para que wagmi (y por
 *      tanto RainbowKit) la descubran como una wallet más, sin reemplazar los
 *      conectores externos.
 *   2. Auto-conecta esa wallet embebida SOLO si no hay ninguna activa, para que
 *      el usuario recién logueado por correo ya tenga wallet lista sin pisar una
 *      wallet externa que él mismo haya elegido.
 */
function PrivyEmbeddedBridge() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const announcedRef = useRef(false);
  const autoConnectedRef = useRef(false);

  const embedded = wallets.find((w) => w.walletClientType === "privy");

  // 1. Anunciar la embebida por EIP-6963.
  useEffect(() => {
    if (!ready || !authenticated || !embedded || announcedRef.current) return;
    let cancelled = false;

    (async () => {
      const provider = await embedded.getEthereumProvider();
      if (cancelled || !provider) return;
      announcedRef.current = true;

      const detail = Object.freeze({
        info: { ...EMBEDDED_INFO, uuid: crypto.randomUUID() },
        provider,
      });
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail })
        );
      // Responder tanto a peticiones futuras como anunciar de inmediato.
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, embedded]);

  // 2. Auto-conectar la embebida si nada está conectado aún.
  useEffect(() => {
    if (autoConnectedRef.current || isConnected || !authenticated) return;
    const embeddedConnector = connectors.find(
      (c) => c.name === EMBEDDED_INFO.name
    );
    if (!embeddedConnector) return;
    autoConnectedRef.current = true;
    connect({ connector: embeddedConnector });
  }, [isConnected, authenticated, connectors, connect]);

  return null;
}

/** Dentro de MiniPay, auto-conecta su wallet inyectada. */
function MiniPayBridge() {
  useMiniPayAutoConnect();
  return null;
}

/**
 * Árbol de providers de Avíspate. Orden (fuera → dentro):
 *   PrivyProvider → QueryClientProvider → WagmiProvider → RainbowKitProvider.
 * La identidad y el ranking siguen atados a Privy (correo); wagmi solo gestiona
 * la wallet ACTIVA (embebida o externa) para pagos, balances y premios.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        // La wallet embebida se provisiona en Celo (red principal).
        defaultChain: celo,
        supportedChains: [celo],
        embeddedWallets: {
          // Sin UIs de Privy: gestionamos la wallet desde nuestra propia UI.
          showWalletUIs: false,
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          solana: {
            createOnLogin: "off",
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider modalSize="compact">
            <PrivyEmbeddedBridge />
            <MiniPayBridge />
            <ProfileProvider>{children}</ProfileProvider>
          </RainbowKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
