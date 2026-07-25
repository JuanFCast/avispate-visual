"use client";

/**
 * Datos compartidos de la ronda diaria: cuenta regresiva al cierre, pozo
 * on-chain por mazo y ranking del día. La tarjeta del lobby y /ranking usan
 * esta única fuente para no duplicar lógica ni consultas.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContract, useReadContracts } from "wagmi";
import { celo } from "viem/chains";
import { DECK_OPTIONS } from "./game";
import {
  AVISPATE_POT_ADDRESS,
  AVISPATE_POT_ABI,
  USDT_DECIMALS,
} from "./contracts";

export interface LeaderboardEntry {
  alias: string;
  walletAddress: string | null;
  averageMs: number;
  errors: number;
  totalMs: number;
}

export function fmtUsdt(units: bigint | undefined): string {
  if (units === undefined) return "…";
  return (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
}

/** Cuenta regresiva al cierre de la ronda: próximas 00:00 UTC = 7pm Colombia. */
export function useRoundCountdown(): string {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0
      );
      let s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
      const h = Math.floor(s / 3600);
      s %= 3600;
      const m = Math.floor(s / 60);
      setLeft(`${h}h ${String(m).padStart(2, "0")}m`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return left;
}

async function fetchLeaderboard(deck: number): Promise<LeaderboardEntry[]> {
  const res = await fetch(`/api/leaderboard?deck=${deck}`);
  if (!res.ok) throw new Error("leaderboard_fetch_failed");
  const data = await res.json();
  return data.leaderboard ?? [];
}

/** Ranking del día para un mazo, con queryKey estable ["leaderboard", deck]. */
export function useLeaderboard(deck: number) {
  return useQuery({
    queryKey: ["leaderboard", deck],
    queryFn: () => fetchLeaderboard(deck),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

/** Pozo actual del mazo en unidades del token (undefined mientras carga). */
export function useDeckPot(deck: number): {
  potUnits: bigint | undefined;
  potEnabled: boolean;
} {
  const potEnabled = Boolean(AVISPATE_POT_ADDRESS);
  const { data } = useReadContract({
    address: AVISPATE_POT_ADDRESS as `0x${string}`,
    abi: AVISPATE_POT_ABI,
    functionName: "pot",
    args: [deck],
    chainId: celo.id,
    query: { enabled: potEnabled, refetchInterval: 15_000 },
  });
  return { potUnits: data as bigint | undefined, potEnabled };
}

/**
 * Jugadas gratis del día según el CONTRATO para la wallet dada: una por mazo
 * por día UTC. Sin wallet aún, asume optimista que la gratis está disponible
 * (una wallet nueva siempre la tiene). `refetch` se llama al volver de una
 * partida para refrescar la elegibilidad.
 */
export function useFreePlays(address: string): {
  freeByDeck: Record<number, boolean>;
  /** La consulta ya respondió (o no aplica todavía). */
  ready: boolean;
  refetch: () => void;
} {
  const enabled = Boolean(AVISPATE_POT_ADDRESS) && Boolean(address);
  const { data, isSuccess, isError, refetch } = useReadContracts({
    contracts: DECK_OPTIONS.map((deck) => ({
      address: AVISPATE_POT_ADDRESS as `0x${string}`,
      abi: AVISPATE_POT_ABI,
      functionName: "hasFreePlayToday",
      args: [deck, address as `0x${string}`],
      chainId: celo.id,
    })),
    query: { enabled, refetchInterval: 60_000 },
  });

  const freeByDeck = Object.fromEntries(
    DECK_OPTIONS.map((deck, i) => {
      const result = data?.[i];
      // Optimista por defecto: wallet nueva (o sin conectar) = gratis lista.
      const free =
        result && result.status === "success" ? Boolean(result.result) : true;
      return [deck, free];
    })
  );

  return {
    freeByDeck,
    ready: !enabled || isSuccess || isError,
    refetch,
  };
}
