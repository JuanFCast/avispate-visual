"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import type { ReactNode } from "react";
import { ProfileProvider } from "./profile-context";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Envuelve la app con Privy (fase 1: solo login por correo + wallet embebida
 * en Celo). Sin Wagmi, RainbowKit ni Solana. Es un componente cliente para
 * poder vivir dentro del `app/layout.tsx` (server component).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        // La wallet embebida se provisiona en Celo (red por defecto).
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
      <ProfileProvider>{children}</ProfileProvider>
    </PrivyProvider>
  );
}
