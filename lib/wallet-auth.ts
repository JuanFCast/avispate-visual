"use client";

import { useCallback, useState } from "react";
import { useLoginWithSiwe } from "@privy-io/react-auth";
import { useAccount, useSignMessage } from "wagmi";
import { celo } from "viem/chains";
import { useProfile } from "./profile-context";
import { useWalletAlias } from "./wallet-alias";

/**
 * Entrar a Avíspate CON la wallet, no solo con la wallet puesta.
 *
 * La distinción importa. Una dirección conectada por wagmi no prueba nada ante
 * el servidor: es un dato que el navegador dice tener. Las rutas de `/api`
 * piden un token de Privy verificado contra su servidor, así que una wallet
 * "conectada" pero no autenticada no puede crear una sala ni jugar — y enseñar
 * su dirección como si ya estuviera lista es justamente la mentira que hay que
 * quitar de la pantalla.
 *
 * Lo que hace este hook es cerrar ese hueco con SIWE (EIP-4361): Privy arma el
 * mensaje, la wallet lo firma, Privy verifica la firma y devuelve una sesión
 * igual de válida que la del correo. A partir de ahí el jugador tiene token,
 * perfil y alias, y la sesión sobrevive a la recarga como cualquier otra.
 */

export type WalletAuthStage =
  /** Nada en curso. */
  | null
  /** Esperando que el jugador firme en su wallet. */
  | "signing"
  /** Privy comprobando la firma y abriendo sesión. */
  | "verifying";

export type WalletAuthError =
  /** Canceló la firma. No es un fallo: es un "ahora no". */
  | "rejected"
  /** Privy rechazó el login con wallet (falta habilitarlo en su panel). */
  | "not_enabled"
  | "failed";

export interface WalletAuthApi {
  /** Hay wallet conectada y todavía NO hay sesión: el caso del botón. */
  needsSignature: boolean;
  address: string | null;
  stage: WalletAuthStage;
  error: WalletAuthError | null;
  continueWithWallet: () => Promise<void>;
  reset: () => void;
}

/** ¿El error de Privy es "wallet no está habilitado como método de login"? */
function looksDisabled(message: string): boolean {
  return /login method|not enabled|not allowed|unsupported/i.test(message);
}

/** ¿El jugador simplemente canceló en su wallet? */
function looksRejected(message: string): boolean {
  return /reject|denied|cancel|user refused/i.test(message);
}

export function useWalletAuth(): WalletAuthApi {
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { authenticated, alias, refresh, setAlias } = useProfile();
  const { walletAlias } = useWalletAlias();

  const [stage, setStage] = useState<WalletAuthStage>(null);
  const [error, setError] = useState<WalletAuthError | null>(null);

  const needsSignature = isConnected && !!address && !authenticated;

  const continueWithWallet = useCallback(async () => {
    if (!address) return;
    setError(null);
    setStage("signing");
    try {
      // La sesión se ata a Celo, que es donde vive el juego, sin importar en
      // qué red esté parada la wallet: firmar un mensaje no cambia de red, y
      // pedirle al jugador que se mueva antes de entrar sobra.
      const message = await generateSiweMessage({
        address,
        chainId: `eip155:${celo.id}`,
      });
      const signature = await signMessageAsync({ message });

      setStage("verifying");
      await loginWithSiwe({ signature, message });

      // Con sesión abierta, el servidor ya puede decir quién es. Si esa wallet
      // venía jugando sin correo, `ensureProfile` adopta el perfil que ya tenía
      // y el alias vuelve solo.
      await refresh();

      // Único caso que el servidor no puede resolver: un alias que solo existía
      // en este teléfono porque el jugador nunca llegó a registrar una marca.
      // Se sube ahora, antes de que la Arena lo llame "0x1234…abcd".
      if (!alias && walletAlias) await setAlias(walletAlias);

      setStage(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        looksRejected(message)
          ? "rejected"
          : looksDisabled(message)
            ? "not_enabled"
            : "failed"
      );
      setStage(null);
    }
  }, [
    address,
    generateSiweMessage,
    signMessageAsync,
    loginWithSiwe,
    refresh,
    alias,
    walletAlias,
    setAlias,
  ]);

  const reset = useCallback(() => setError(null), []);

  return {
    needsSignature,
    address: address ?? null,
    stage,
    error,
    continueWithWallet,
    reset,
  };
}
