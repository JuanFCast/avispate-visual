"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./wagmi";
import { useMiniPayAutoConnect } from "./minipay";
import { EmbeddedWalletProvider } from "./embedded-wallet";
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
 *   PrivyProvider → WagmiProvider → RainbowKitProvider → ProfileProvider
 *   → EmbeddedWalletProvider.
 * La identidad y el ranking siguen atados a Privy (correo); wagmi solo gestiona
 * la wallet ACTIVA (embebida o externa) para pagos, balances y premios. El
 * puente entre las dos —crear la embebida y conectarla, con sus reintentos—
 * vive en `embedded-wallet.tsx`.
 */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

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
            /**
             * APAGADO a propósito, y es lo que cierra el incidente PipeRabby.
             *
             * `"users-without-wallets"` suena a lo que queremos y no lo es:
             * Privy decide quién "no tiene wallets" mirando SU registro
             * (`linkedAccounts`), que no sabe nada del perfil de Avíspate. Un
             * jugador que entra por correo con su Rabby solo CONECTADA —no
             * enlazada a su cuenta de Privy— cuenta como usuario sin wallets, y
             * se le provisiona una embebida aunque su perfil lleve meses
             * apuntando a una dirección con historial y premios. Esa columna
             * vive en nuestra base y Privy no puede consultarla.
             *
             * Así que la decisión se toma donde sí se ve el perfil:
             * `decideEmbeddedCreation` en `wallet-identity.ts`, ejecutada por
             * `embedded-wallet.tsx`. Un jugador nuevo de verdad sigue teniendo
             * su embebida — la crea nuestro código en cuanto consta que no
             * tiene ninguna; uno que ya tiene wallet no recibe una segunda,
             * esté su extensión bloqueada o no.
             */
            createOnLogin: "off",
          },
          solana: {
            createOnLogin: "off",
          },
        },
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider modalSize="compact">
          {/* El perfil va POR FUERA de la wallet embebida, y ese orden es
              parte del arreglo: quien decide si hay que crear una embebida
              necesita saber si esta identidad ya tiene wallet, y eso lo sabe
              el perfil. Al revés —como estaba— la decisión se tomaba a ciegas.
              `ProfileProvider` no depende de la embebida: se apoya en Privy y
              en la sesión de wallet, las dos ya disponibles aquí. */}
          <ProfileProvider>
            <EmbeddedWalletProvider>
              <MiniPayBridge />
              <WelcomeGasBridge />
              <OutboxBridge />
              {children}
            </EmbeddedWalletProvider>
          </ProfileProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}
