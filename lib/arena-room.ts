"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROOM_HEARTBEAT_MS,
  roomChannelName,
  type RoomError,
  type RoomView,
} from "./arena-rooms";
import { useProfile } from "./profile-context";
import { getSupabaseBrowser } from "./supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * El estado de una sala privada, vivo, en la pantalla.
 *
 * Dos mecanismos, y hacen falta los dos:
 *
 *   · El LATIDO. Cada pocos segundos se vuelve a pedir la sala. Es la verdad
 *     —siempre viene del servidor, verificada contra Privy— y a la vez es la
 *     forma de decir "sigo aquí": el mismo GET refresca `last_seen_at`, que es
 *     lo único que distingue a quien mira la sala de quien cerró la pestaña.
 *
 *   · El BROADCAST de Realtime. Un canal por sala en el que cada cliente avisa
 *     "toqué algo" para que los demás pregunten YA en vez de esperar al
 *     siguiente latido. No lleva datos: el mensaje solo empuja, nunca informa,
 *     así que nadie puede mentirle a la pantalla desde el canal. Si falta la
 *     anon key, esto simplemente no existe y la sala sigue funcionando, un
 *     poco más lenta.
 *
 * Nada de esto cobra, bloquea fondos ni inicia partidas.
 */

export interface ArenaRoomState {
  room: RoomView | null;
  /** Por qué no hay sala: código inválido, no existe, cerrada… */
  error: RoomError | null;
  /** Primera carga: no hay nada que pintar todavía. */
  loading: boolean;
  /** Hay una acción en vuelo (entrar, listo, salir). */
  busy: boolean;
  /**
   * Latidos seguidos que no llegaron a su destino. Uno se pierde y no pasa
   * nada; varios seguidos significan que quien está desconectado eres tú, y
   * eso hay que decirlo antes de que la sala en pantalla envejezca en silencio.
   */
  failures: number;
}

export interface ArenaRoomApi extends ArenaRoomState {
  refresh: () => Promise<void>;
  join: () => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  leave: () => Promise<void>;
  /** El anfitrión reparte. Los dos acaban en la partida por `matchStarted`. */
  start: () => Promise<void>;
}

export function useArenaRoom(code: string): ArenaRoomApi {
  const { ready, authenticated, getToken } = useProfile();
  const [state, setState] = useState<ArenaRoomState>({
    room: null,
    error: null,
    loading: true,
    busy: false,
    failures: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Un código que no existe no va a existir por preguntarlo cada cuatro
  // segundos, y una sala cerrada no vuelve a abrir. Ahí el latido para.
  const stopRef = useRef(false);
  // El latido y el refresco tienen que poder llamarse sin re-suscribir nada,
  // así que la función viaja por ref y los efectos no dependen de ella.
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const inFlight = useRef(false);

  /** Cabeceras con el token de Privy cuando hay sesión; sin él también se lee. */
  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!authenticated) return {};
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [authenticated, getToken]);

  const refresh = useCallback(async () => {
    if (stopRef.current) return;
    // Dos latidos encimados no traen más información: el segundo se descarta.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/arena/rooms/${encodeURIComponent(code)}`, {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setState((s) => ({
          ...s,
          loading: false,
          failures: 0,
          error: (data?.error as RoomError) ?? "server_error",
        }));
        return;
      }
      setState((s) => ({
        ...s,
        room: data as RoomView,
        error: null,
        loading: false,
        failures: 0,
      }));
    } catch {
      // Un latido perdido no vacía la pantalla: la sala que ya se ve sigue
      // siendo la mejor información disponible hasta el siguiente intento.
      setState((s) => ({
        ...s,
        loading: false,
        failures: s.failures + 1,
        error: s.room ? s.error : "server_error",
      }));
    } finally {
      inFlight.current = false;
    }
  }, [code, authHeaders]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    stopRef.current =
      state.error === "invalid_code" ||
      state.error === "room_not_found" ||
      state.room?.status === "closed";
  }, [state.error, state.room?.status]);

  /** Empuja a los demás clientes de la sala. Silencioso si no hay canal. */
  const notify = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "sync", payload: {} });
  }, []);

  /** Una acción sobre la sala: la ejecuta, refresca y avisa a los demás. */
  const act = useCallback(
    async (path: string, body?: unknown) => {
      setState((s) => ({ ...s, busy: true }));
      try {
        const headers = await authHeaders();
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body ?? {}),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setState((s) => ({
            ...s,
            busy: false,
            error: (data?.error as RoomError) ?? "server_error",
          }));
          return;
        }
        // La respuesta de "listo" ya trae la sala entera: se pinta sin esperar.
        if (data && typeof data === "object" && "players" in data) {
          setState((s) => ({ ...s, room: data as RoomView, error: null, busy: false }));
        } else {
          setState((s) => ({ ...s, busy: false }));
          await refresh();
        }
        notify();
      } catch {
        setState((s) => ({ ...s, busy: false, error: "server_error" }));
      }
    },
    [authHeaders, notify, refresh]
  );

  // `act` ya refresca cuando la respuesta no trae la sala entera, que es el
  // caso de entrar: el servidor solo confirma el código.
  const join = useCallback(async () => {
    await act("/api/arena/rooms/join", { code });
  }, [act, code]);

  const setReady = useCallback(
    async (value: boolean) => {
      await act(`/api/arena/rooms/${encodeURIComponent(code)}/ready`, {
        ready: value,
      });
    },
    [act, code]
  );

  const leave = useCallback(async () => {
    await act(`/api/arena/rooms/${encodeURIComponent(code)}/leave`);
  }, [act, code]);

  // El invitado no toca este botón: se entera de que la partida existe por el
  // `matchStarted` del siguiente latido, o por el empujón del broadcast.
  const start = useCallback(async () => {
    await act("/api/arena/matches", { code });
  }, [act, code]);

  // Primera carga y latido. Se espera a que Privy hidrate para que el primer
  // GET ya lleve token: si no, la sala se pintaría un instante sin "tú".
  useEffect(() => {
    if (!ready) return;
    refreshRef.current();
    const id = setInterval(() => refreshRef.current(), ROOM_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [ready, code, authenticated]);

  // Volver a la pestaña es el momento en que la sala más desactualizada está.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Canal de la sala. `self: false` porque quien actúa ya se refrescó solo.
  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) return;
    const channel = client.channel(roomChannelName(code), {
      config: { broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "sync" }, () => {
      refreshRef.current();
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      client.removeChannel(channel);
    };
  }, [code]);

  return { ...state, refresh, join, setReady, leave, start };
}
