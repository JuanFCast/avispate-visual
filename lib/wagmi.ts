"use client";

import { http } from "viem";
import { celo, base, mainnet } from "viem/chains";
import { createConfig } from "wagmi";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { CELO_TRANSPORT, MAINNET_RPC_URL } from "./chain";

// De WalletConnect Cloud (https://cloud.walletconnect.com). RainbowKit EXIGE un
// projectId no vacío o lanza error en build/runtime. Usamos un placeholder de
// reserva para que build y dev funcionen sin config; hay que poner el real para
// que WalletConnect (y wallets basadas en él) conecten de verdad.
const WALLETCONNECT_PLACEHOLDER = "avispate_missing_walletconnect_project_id";
const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || WALLETCONNECT_PLACEHOLDER;

if (
  typeof window !== "undefined" &&
  WALLETCONNECT_PROJECT_ID === WALLETCONNECT_PLACEHOLDER
) {
  console.warn(
    "[Avíspate] Falta NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. WalletConnect no " +
      "funcionará hasta configurarlo (https://cloud.walletconnect.com)."
  );
}

// Conectores manuales de RainbowKit (no delegamos en la integración simple de
// @privy-io/wagmi, para conservar todas estas wallets externas).
const rainbowKitConnectors = connectorsForWallets(
  [
    {
      groupName: "Recomendadas",
      wallets: [
        metaMaskWallet,
        rabbyWallet,
        coinbaseWallet,
        rainbowWallet,
        trustWallet,
        walletConnectWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: "Avíspate",
    projectId: WALLETCONNECT_PROJECT_ID,
  }
);

/**
 * Config de wagmi creada directamente con `createConfig` (no con la de Privy).
 * La wallet embebida de Privy se inyecta aparte, anunciándola por EIP-6963
 * (ver PrivyEmbeddedBridge en privy-provider.tsx). El conector de Farcaster va
 * primero para auto-conectar dentro de Warpcast / Base App sin salir en el
 * selector.
 */
export const wagmiConfig = createConfig({
  chains: [celo, base, mainnet],
  transports: {
    [celo.id]: CELO_TRANSPORT,
    [base.id]: http(),
    [mainnet.id]: http(MAINNET_RPC_URL),
  },
  connectors: [farcasterMiniApp(), ...rainbowKitConnectors],
  ssr: true,
});
