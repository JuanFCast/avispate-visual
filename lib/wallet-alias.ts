"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveWallet } from "./wallet";

/**
 * Alias de un jugador SOLO-wallet (sin correo).
 *
 * El alias es de la BILLETERA, no del dispositivo. El servidor manda: lo que
 * hay en `localStorage` es solo una copia para pintar sin parpadeo mientras
 * llega la respuesta. Cuando alguien vuelve desde otro teléfono, otro
 * navegador o —como pasó al mudarnos a avispate.fun— otro dominio, recupera su
 * nombre solo, en vez de que la app se lo pregunte de nuevo y luego lo rechace
 * por estar tomado por él mismo.
 */

const keyFor = (address: string) => `avispate_alias_${address}`;

function readLocal(address: string): string | null {
  try {
    return localStorage.getItem(keyFor(address));
  } catch {
    return null;
  }
}

function writeLocal(address: string, alias: string): void {
  try {
    localStorage.setItem(keyFor(address), alias);
  } catch {
    // localStorage bloqueado: la sesión actual igual lo tiene en memoria.
  }
}

async function fetchWalletAlias(address: string): Promise<string | null> {
  const res = await fetch(
    `/api/wallet-alias?address=${encodeURIComponent(address)}`
  );
  if (!res.ok) throw new Error("wallet_alias_failed");
  const data = (await res.json()) as { alias: string | null };
  return data.alias;
}

export function useWalletAlias(): {
  walletAlias: string | null;
  /** Ya sabemos si esta wallet tiene alias (o no hay wallet que consultar). */
  ready: boolean;
  setWalletAlias: (alias: string) => void;
} {
  const { address } = useActiveWallet();
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<string | null>(null);

  // 1. La copia del dispositivo, al instante.
  useEffect(() => {
    setLocal(address ? readLocal(address) : null);
  }, [address]);

  // 2. La fuente de verdad. Compartida entre el lobby y el perfil por la
  //    caché de react-query: una sola consulta por wallet.
  const { data: remote, isFetched } = useQuery({
    queryKey: ["wallet-alias", address],
    queryFn: () => fetchWalletAlias(address),
    enabled: Boolean(address),
    staleTime: 5 * 60_000,
  });

  // 3. Si el servidor tiene otro (o el dispositivo no tenía ninguno), gana el
  //    servidor: es el nombre que sale en el ranking.
  useEffect(() => {
    if (!address || !remote || remote === local) return;
    writeLocal(address, remote);
    setLocal(remote);
  }, [address, remote, local]);

  const setWalletAlias = useCallback(
    (alias: string) => {
      setLocal(alias);
      if (!address) return;
      writeLocal(address, alias);
      // Que el otro consumidor del hook lo vea sin volver a preguntar.
      queryClient.setQueryData(["wallet-alias", address], alias);
    },
    [address, queryClient]
  );

  return {
    // El alias elegido en este dispositivo vale mientras el servidor no tenga
    // ninguno: se reclama allá en la primera jugada.
    walletAlias: remote ?? local,
    ready: !address || isFetched,
    setWalletAlias,
  };
}
