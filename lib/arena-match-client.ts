"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rememberSeatToken, withSeatHeader } from "./seat-token-client";
import { seatSecretFor } from "./seat-secret";
import { withSeatRecovery } from "./arena-seat-recovery";
import { useActiveWallet } from "./wallet";
import {
  matchPollMs,
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
  // La wallet activa, para poder pedir una ficha nueva si la de la silla vence
  // a mitad de partida. Es la que pagó: `/api/arena/seat` comprueba el secreto
  // contra la huella que ESA dirección dejó en la cadena.
  const wallet = useActiveWallet();
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

  /**
   * La sesión y, en una mesa con entrada, la ficha de la silla. Van en
   * cabeceras distintas a propósito: una dice quién eres y la otra qué silla
   * probaste, y no deben compartir canal.
   */
  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = authenticated ? await getToken() : null;
    const base: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    return withSeatHeader(base, code);
  }, [authenticated, getToken, code]);

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

  /*
   * `stopRef` solo frena lo que ya no tiene respuesta posible. La partida
   * terminada NO entra aquí, aunque antes sí: el ritmo del latido lo decide
   * `matchPollMs`, que en esa fase baja a seis segundos mientras falte
   * confirmar el pago del premio y luego para. Frenarlo aquí además dejaba el
   * `refresh` manual muerto, y con él la única forma de que el ganador viera
   * "pagado" sin recargar la página.
   */
  useEffect(() => {
    stopRef.current = state.error === "no_match";
  }, [state.error]);

  /** Empuja a la otra pantalla. Solo dice "mira otra vez"; no lleva estado. */
  const notify = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "move", payload: {} });
  }, []);

  /**
   * Una ficha nueva para esta mesa, enseñando el secreto que sigue guardado.
   *
   * No firma, no cobra y no toca la cadena para escribir: el secreto se guardó
   * antes de pagar y `/api/arena/seat` lo cambia por una ficha las veces que
   * haga falta. Devuelve `null` si no hay con qué pedirla —mesa gratis, secreto
   * perdido, wallet desconectada— y entonces no hay rescate posible.
   */
  const claimSeat = useCallback(async (): Promise<string | null> => {
    const tableId = state.view?.stakes.tableId;
    if (!tableId || !wallet.address) return null;
    const secret = seatSecretFor(tableId);
    if (!secret) return null;
    try {
      const res = await fetch("/api/arena/seat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, address: wallet.address, secret }),
      });
      const data = (await res.json().catch(() => null)) as {
        token?: string;
      } | null;
      return res.ok ? (data?.token ?? null) : null;
    } catch {
      return null;
    }
  }, [state.view?.stakes.tableId, wallet.address, code]);

  /**
   * Manda un toque. Lo que va al servidor es lo que el jugador VIO —contra qué
   * base y con qué carta— para que él pueda decidir si eso todavía era cierto
   * cuando llegó.
   *
   * Si la ficha de la silla venció a mitad de partida, se renueva y el toque se
   * repite UNA vez (`arena-seat-recovery.ts`). Sin eso, una ficha vencida
   * rechazaba todos los movimientos y el jugador perdía por abandono una
   * partida que estaba jugando — o sea, entregaba el pozo por un reloj.
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
        const attempt = await withSeatRecovery({
          send: async () => {
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
            return {
              status: res.status,
              error: (data?.error as string) ?? undefined,
              value: res.ok ? data : null,
            };
          },
          claim: claimSeat,
          // Guardarla ANTES del reintento es lo que hace que el segundo envío
          // la lleve: `authHeaders` la lee del almacenamiento en cada llamada.
          remember: (token) => rememberSeatToken(code, token),
        });

        const data = attempt.value;
        if (!data?.view) {
          setState((s) => ({
            ...s,
            error: (attempt.error as MatchError) ?? "server_error",
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
    [state.view, code, authHeaders, absorb, notify, claimSeat]
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
  // las dos manos es la tuya. El ritmo cambia con la fase y puede apagarse del
  // todo: ver `matchPollMs`.
  const pollMs = matchPollMs(state.view, state.error, Date.now());

  useEffect(() => {
    if (!ready || !authenticated || pollMs === null) return;
    refreshRef.current();
    const id = setInterval(() => refreshRef.current(), pollMs);
    return () => clearInterval(id);
  }, [ready, authenticated, code, pollMs]);

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
