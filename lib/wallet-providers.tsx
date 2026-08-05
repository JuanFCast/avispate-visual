"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import { useEffect, useRef, type ReactNode } from "react";
import { WagmiProvider, useAccount, useConnect } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./wagmi";
import { useMiniPayAutoConnect } from "./minipay";
import { ProfileProvider } from "./profile-context";
import WelcomeGasBridge from "@/components/WelcomeGasBridge";
import OutboxBridge from "@/components/OutboxBridge";

/**
 * TODO lo pesado de la app vive en este archivo, y vive aquí a propósito.
 *
 * Privy, wagmi, RainbowKit y el catálogo de wallets son cerca de un megabyte
 * comprimido. Mientras estuvieron en el árbol de providers del layout raíz, ese
 * megabyte lo descargaba CUALQUIER ruta — incluidas `/terminos` y `/privacidad`,
 * que son dos páginas de texto sin un solo botón de wallet.
 *
 * Separado en su propio módulo, `privy-provider.tsx` puede pedirlo con
 * `next/dynamic` solo en las rutas que de verdad lo usan. Sin `ssr: false`: el
 * HTML se sigue renderizando en el servidor —quitarlo arruinaría el LCP de la
 * pantalla de jugar, que es justo la que MiniPay mide— y lo único que cambia es
 * que el chunk deja de pedirse donde nadie lo necesita.
 *
 * Orden (fuera → dentro):
 *   PrivyProvider → WagmiProvider → RainbowKitProvider → ProfileProvider.
 * La identidad y el ranking siguen atados a Privy (correo); wagmi solo gestiona
 * la wallet ACTIVA (embebida o externa) para pagos, balances y premios.
 */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

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

export default function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        /*
         * Correo Y wallet. El correo va primero porque sigue siendo el
         * camino por defecto, pero la wallet ahora es una IDENTIDAD y no
         * solo un medio de pago: sin esto, `loginWithSiwe` no está permitido
         * para la app y firmar no sirve de nada.
         *
         * Ojo: esto es la mitad del interruptor. La otra mitad está en el
         * panel de Privy (Login methods → Wallet); si allí está apagado, la
         * firma se hace pero el login se rechaza.
         */
        loginMethods: ["email", "wallet"],
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
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider modalSize="compact">
          <PrivyEmbeddedBridge />
          <MiniPayBridge />
          <WelcomeGasBridge />
          <OutboxBridge />
          <ProfileProvider>{children}</ProfileProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}
