"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MATCH_POLL_MS,
  type MatchError,
  type MatchView,
  type MoveOutcome,
} from "./arena-match";
import { useProfile } from "./profile-context";
import { getSupabaseBrowser } from "./supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * La partida, viva, en la pantalla.
 *
 * Mismo esqueleto que la sala —latido que manda, broadcast que empuja— pero con
 * el reloj apretado: aquí un segundo de retraso en la base compartida no es una
 * demora, es el juego roto. El latido baja a un segundo y cada jugada avisa a
 * la otra pantalla en el acto.
 *
 * Lo que NO hace: decidir. El acierto, el castigo y el ganador llegan siempre
 * del servidor. La pantalla se adelanta para que el toque se sienta inmediato
 * (ver `ArenaMatch`), pero lo que queda escrito es lo que respondió el servidor.
 */

export interface ArenaMatchState {
  view: MatchView | null;
  error: MatchError | null;
  loading: boolean;
  /** Latidos seguidos perdidos: a partir de tres, el desconectado eres tú. */
  failures: number;
}

export interface PlayResult {
  outcome: MoveOutcome;
  /** El símbolo que compartían las dos cartas, cuando el servidor da el acierto. */
  matchedSymbol: string | null;
}

export interface ArenaMatchApi extends ArenaMatchState {
  /** Reloj del servidor estimado, en milisegundos. Para la cuenta regresiva. */
  serverNow: () => number;
  refresh: () => Promise<void>;
  play: (symbolId: string) => Promise<PlayResult | null>;
  leave: () => Promise<void>;
}

export function useArenaMatch(code: string): ArenaMatchApi {
  const { ready, authenticated, getToken } = useProfile();
  const [state, setState] = useState<ArenaMatchState>({
    view: null,
    error: null,
    loading: true,
    failures: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const inFlight = useRef(false);
  const playing = useRef(false);
  const stopRef = useRef(false);
  /**
   * Cuánto adelanta o atrasa el teléfono respecto al servidor. La cuenta
   * regresiva se dibuja con esto: si cada uno usara su propio reloj, uno vería
   * el "¡ya!" antes que el otro y empezaría con ventaja.
   */
  const offset = useRef(0);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = authenticated ? await getToken() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [authenticated, getToken]);

  const absorb = useCallback((view: MatchView) => {
    offset.current = new Date(view.serverNow).getTime() - Date.now();
    setState((s) => ({ ...s, view, error: null, loading: false, failures: 0 }));
  }, []);

  const refresh = useCallback(async () => {
    if (stopRef.current || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/arena/matches/${encodeURIComponent(code)}`, {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setState((s) => ({
          ...s,
          loading: false,
          failures: 0,
          error: (data?.error as MatchError) ?? "server_error",
        }));
        return;
      }
      absorb(data as MatchView);
    } catch {
      // Un latido perdido no borra la partida de la pantalla: lo último que se
      // supo sigue siendo mejor que un vacío.
      setState((s) => ({
        ...s,
        loading: false,
        failures: s.failures + 1,
        error: s.view ? s.error : "server_error",
      }));
    } finally {
      inFlight.current = false;
    }
  }, [code, authHeaders, absorb]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    stopRef.current = state.error === "no_match" || state.view?.phase === "finished";
  }, [state.error, state.view?.phase]);

  /** Empuja a la otra pantalla. Solo dice "mira otra vez"; no lleva estado. */
  const notify = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "move", payload: {} });
  }, []);

  /**
   * Manda un toque. Lo que va al servidor es lo que el jugador VIO —contra qué
   * base y con qué carta— para que él pueda decidir si eso todavía era cierto
   * cuando llegó.
   */
  const play = useCallback(
    async (symbolId: string): Promise<PlayResult | null> => {
      const view = state.view;
      if (!view || view.myCard === null || view.phase !== "playing") return null;
      // Un toque a la vez: el segundo llegaría con la carta ya gastada y solo
      // serviría para pintar un destello que el servidor va a desmentir.
      if (playing.current) return null;
      playing.current = true;
      try {
        const res = await fetch(
          `/api/arena/matches/${encodeURIComponent(code)}/move`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(await authHeaders()),
            },
            body: JSON.stringify({
              seq: view.seq,
              card: view.myCard,
              symbolId,
            }),
          }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.view) {
          setState((s) => ({
            ...s,
            error: (data?.error as MatchError) ?? "server_error",
          }));
          return null;
        }
        absorb(data.view as MatchView);
        notify();
        return {
          outcome: data.outcome as MoveOutcome,
          matchedSymbol: (data.matchedSymbol as string | null) ?? null,
        };
      } catch {
        setState((s) => ({ ...s, failures: s.failures + 1 }));
        return null;
      } finally {
        playing.current = false;
      }
    },
    [state.view, code, authHeaders, absorb, notify]
  );

  const leave = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/arena/matches/${encodeURIComponent(code)}/leave`,
        { method: "POST", headers: await authHeaders() }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data) absorb(data as MatchView);
      notify();
    } catch {
      // Irse no puede fallar: si el aviso no llega, el otro gana igual cuando
      // el servidor note que este jugador dejó de latir.
    }
  }, [code, authHeaders, absorb, notify]);

  // Latido. Espera a que Privy hidrate: sin token, el servidor no sabe cuál de
  // las dos manos es la tuya.
  useEffect(() => {
    if (!ready || !authenticated) return;
    refreshRef.current();
    const id = setInterval(() => refreshRef.current(), MATCH_POLL_MS);
    return () => clearInterval(id);
  }, [ready, authenticated, code]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) return;
    const channel = client.channel(`arena-match:${code}`, {
      config: { broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "move" }, () => {
      refreshRef.current();
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      client.removeChannel(channel);
    };
  }, [code]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { ...state, serverNow, refresh, play, leave };
}
