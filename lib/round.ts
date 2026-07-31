"use client";

/**
 * Datos compartidos de la ronda diaria: cuenta regresiva al cierre, pozo
 * on-chain por mazo y ranking del día. La tarjeta del lobby y /ranking usan
 * esta única fuente para no duplicar lógica ni consultas.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useReadContract, useReadContracts } from "wagmi";
import { celo } from "viem/chains";
import { DECK_OPTIONS } from "./game";
import { closeHintFor, formatCountdown } from "./round-time";
import { useI18n } from "./i18n/client";
import type { Translate } from "./i18n";
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

/* ------------------------------ Reloj de ronda ----------------------------- */

/**
 * El servidor solo entrega rondas abiertas: a la hora del cierre la siguiente
 * ya empezó. El ganador de la ronda anterior no cabe en el contador — se lee
 * en /historial.
 */
export type RoundStatus = "open";

/** Respuesta de `/api/round`: la verdad sobre la ronda vive en el servidor. */
export interface RoundInfo {
  roundId: string;
  deck: number;
  serverNow: string;
  closesAt: string;
  status: RoundStatus;
}

interface RoundSnapshot extends RoundInfo {
  /** Reloj del servidor menos el del dispositivo, en ms. */
  offsetMs: number;
  closesAtMs: number;
}

async function fetchRound(deck: number): Promise<RoundSnapshot> {
  const sentAt = Date.now();
  const res = await fetch(`/api/round?deck=${deck}`, { cache: "no-store" });
  if (!res.ok) throw new Error("round_fetch_failed");
  const info = (await res.json()) as RoundInfo;
  // El punto medio de la ida y vuelta es el instante local que corresponde a
  // `serverNow`: reparte el error de red en vez de cargarlo todo a la llegada.
  const localAtServerNow = (sentAt + Date.now()) / 2;
  return {
    ...info,
    offsetMs: Date.parse(info.serverNow) - localAtServerNow,
    closesAtMs: Date.parse(info.closesAt),
  };
}

export interface RoundClock {
  status: RoundStatus | "loading" | "error";
  roundId: string | null;
  /** "01:42:18". Se recalcula desde `closesAt`, nunca se decrementa. */
  remaining: string;
  remainingMs: number;
  /** El corte ya pasó según el reloj del servidor. */
  reachedCut: boolean;
  closeHint: string;
  refetch: () => void;
}

/**
 * Cuenta regresiva al cierre de la ronda, idéntica en cualquier país.
 *
 * El servidor manda: entrega `serverNow` y `closesAt`, y de ahí sale un
 * desfase que corrige un teléfono adelantado o atrasado. Cada segundo el
 * tiempo restante se RECALCULA desde `closesAt` (no se resta de una variable),
 * así que una pestaña dormida o un móvil bloqueado vuelven con la hora
 * correcta. Al llegar a cero no se reinicia nada por cuenta propia: se
 * pregunta al servidor hasta que entregue la ronda siguiente.
 */
export function useRoundClock(deck: number): RoundClock {
  const { lang } = useI18n();
  const query = useQuery({
    queryKey: ["round", deck],
    queryFn: () => fetchRound(deck),
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (q) => {
      const snap = q.state.data;
      if (!snap) return 30_000;
      const left = snap.closesAtMs - (Date.now() + snap.offsetMs);
      // Pasado el corte seguimos con la foto vieja: preguntar seguido hasta
      // que el servidor entregue la ronda del día siguiente.
      if (left <= 0) return 5_000;
      return Math.min(60_000, Math.max(5_000, left));
    },
  });

  // Un tick por segundo redibuja el contador; el valor sale del cálculo de
  // abajo, no de este estado.
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const id = setInterval(bump, 1000);
    // Volver a primer plano, recuperar foco o reconectar: recalcular ya.
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("focus", bump);
    window.addEventListener("online", bump);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("focus", bump);
      window.removeEventListener("online", bump);
    };
  }, []);

  // Cambio de ronda: TODO lo del día anterior que quedaba en caché ya no vale.
  //
  //   ["leaderboard"]  el ranking vuelve a empezar vacío
  //   ["readContract"] el pozo se pagó y se resembró, y la jugada gratis del
  //                    día se renovó — ambos se leen del contrato
  //
  // Sin esto el jugador se queda hasta un minuto viendo el premio de ayer
  // después de que el robot ya lo pagó, que es justo el momento en que más
  // mira la pantalla. Invalidar el grupo entero de lecturas on-chain es
  // deliberado: al cruzar la medianoche UTC no hay ninguna que siga válida.
  const queryClient = useQueryClient();
  const snapshot = query.data;
  const roundId = snapshot?.roundId ?? null;
  const lastRound = useRef<string | null>(null);
  useEffect(() => {
    if (!roundId) return;
    if (lastRound.current && lastRound.current !== roundId) {
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    }
    lastRound.current = roundId;
  }, [roundId, queryClient]);

  const now = Date.now();
  const remainingMs = snapshot
    ? Math.max(0, snapshot.closesAtMs - (now + snapshot.offsetMs))
    : 0;

  return {
    status: snapshot ? snapshot.status : query.isError ? "error" : "loading",
    roundId,
    remaining: formatCountdown(remainingMs),
    remainingMs,
    reachedCut: Boolean(snapshot) && remainingMs <= 0,
    closeHint: snapshot ? closeHintFor(snapshot.closesAtMs, now, lang) : "",
    refetch: () => void query.refetch(),
  };
}

export interface RoundCopy {
  primary: string;
  secondary: string;
  /** El secundario es un botón de reintento, no un texto informativo. */
  retry: boolean;
}

/** Copys del contador por estado, en un solo sitio para no divergir. */
export function roundCopy(clock: RoundClock, t: Translate): RoundCopy {
  if (clock.status === "error") {
    return {
      primary: t("round.error"),
      secondary: t("common.retry"),
      retry: true,
    };
  }
  if (clock.status === "loading") {
    return { primary: t("round.loading"), secondary: "", retry: false };
  }
  // El corte ya pasó pero seguimos con la foto vieja: falta un segundo para
  // que el servidor entregue la ronda nueva. Se muestra el neutral "Cierra
  // en …" y NUNCA "ronda cerrada" ni el ganador de ayer — la ronda siguiente
  // ya abrió y ya acepta jugadas, así que cualquier otra cosa sería mentir
  // durante ese segundo.
  if (clock.reachedCut) {
    return { primary: t("round.loading"), secondary: "", retry: false };
  }
  return {
    primary: t("round.closes_in", { time: clock.remaining }),
    secondary: clock.closeHint,
    retry: false,
  };
}

/**
 * `fresh` es para el jugador que ACABA de terminar una partida: la respuesta
 * del ranking se cachea en el CDN, así que una lectura normal puede devolver
 * una copia anterior a su marca. El parámetro sobrante hace que esa petición
 * sea otra URL para el CDN y llegue hasta la base de datos.
 */
async function fetchLeaderboard(
  deck: number,
  fresh = false
): Promise<LeaderboardEntry[]> {
  const bust = fresh ? `&fresh=${Date.now()}` : "";
  const res = await fetch(`/api/leaderboard?deck=${deck}${bust}`, {
    cache: "no-store",
  });
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

/**
 * Recarga el ranking de un mazo YA y deja el resultado en la caché.
 *
 * Se usa al terminar una partida: en ese momento el top del lobby ni siquiera
 * está montado, así que invalidar solo lo marcaría como viejo y el jugador
 * volvería al lobby sin verse. `fetchQuery` trae los datos aunque no haya
 * nadie mirando, y salta la caché del CDN para que su marca ya venga incluida.
 */
export async function refreshLeaderboard(
  queryClient: QueryClient,
  deck: number
): Promise<void> {
  await queryClient.fetchQuery({
    queryKey: ["leaderboard", deck],
    queryFn: () => fetchLeaderboard(deck, true),
    staleTime: 0,
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
