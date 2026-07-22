"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveWallet } from "./wallet";

/**
 * Alias local de un jugador SOLO-wallet (sin correo), guardado por dirección en
 * localStorage. Compartido entre el juego y el perfil para que estén en sync.
 */
export function useWalletAlias(): {
  walletAlias: string | null;
  setWalletAlias: (alias: string) => void;
} {
  const { address } = useActiveWallet();
  const [walletAlias, setState] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setState(null);
      return;
    }
    try {
      setState(localStorage.getItem(`avispate_alias_${address}`));
    } catch {
      setState(null);
    }
  }, [address]);

  const setWalletAlias = useCallback(
    (alias: string) => {
      setState(alias);
      try {
        if (address) localStorage.setItem(`avispate_alias_${address}`, alias);
      } catch {
        // localStorage bloqueado: la sesión actual igual lo tiene.
      }
    },
    [address]
  );

  return { walletAlias, setWalletAlias };
}
