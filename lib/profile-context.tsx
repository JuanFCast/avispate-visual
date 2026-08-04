"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  readWalletSession,
  WALLET_SESSION_EVENT,
} from "./wallet-session-client";

interface ProfileState {
  /** Aún cargando el perfil del servidor. */
  loading: boolean;
  /** Alias del jugador, o null si todavía no lo eligió. */
  alias: string | null;
  /** Wallet embebida en minúsculas, o null. */
  walletAddress: string | null;
}

interface ProfileContextValue extends ProfileState {
  /** Privy terminó de hidratar (sabemos si hay sesión o no). */
  ready: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
  setAlias: (alias: string) => Promise<{ ok: boolean; error?: string }>;
  /** Token de acceso de Privy para llamar a las rutas protegidas. */
  getToken: () => Promise<string | null>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

const EMPTY: ProfileState = { loading: false, alias: null, walletAddress: null };

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated: privyAuth, getAccessToken } = usePrivy();
  const [state, setState] = useState<ProfileState>({ ...EMPTY, loading: true });
  // Sesión de wallet (MiniPay, sin firma). Se lee en un efecto y no durante el
  // render: `localStorage` no existe en el servidor y tocarlo antes de montar
  // rompe la hidratación.
  const [walletSession, setWalletSession] = useState(false);

  useEffect(() => {
    const sync = () => setWalletSession(Boolean(readWalletSession()));
    sync();
    window.addEventListener(WALLET_SESSION_EVENT, sync);
    return () => window.removeEventListener(WALLET_SESSION_EVENT, sync);
  }, []);

  const authenticated = privyAuth || walletSession;

  /**
   * Privy manda cuando hay sesión suya: es la identidad más completa (correo,
   * wallet embebida) y la que el jugador eligió explícitamente. La de wallet es
   * el camino de MiniPay, donde no hay otra.
   */
  const getToken = useCallback(async () => {
    if (privyAuth) {
      const token = await getAccessToken();
      if (token) return token;
    }
    return readWalletSession()?.token ?? null;
  }, [privyAuth, getAccessToken]);

  const refresh = useCallback(async () => {
    if (!authenticated) {
      setState(EMPTY);
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const token = await getToken();
    if (!token) {
      setState(EMPTY);
      return;
    }
    try {
      const res = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("profile_fetch_failed");
      const data = await res.json();
      setState({
        loading: false,
        alias: data.alias ?? null,
        walletAddress: data.walletAddress ?? null,
      });
    } catch {
      setState(EMPTY);
    }
  }, [authenticated, getToken]);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, authenticated, refresh]);

  const setAlias = useCallback(
    async (alias: string) => {
      const token = await getToken();
      if (!token) return { ok: false, error: "no_session" };
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ alias }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? "error" };
      setState((s) => ({ ...s, alias: data.alias }));
      return { ok: true };
    },
    [getToken]
  );

  return (
    <ProfileContext.Provider
      value={{ ...state, ready, authenticated, refresh, setAlias, getToken }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile debe usarse dentro de <ProfileProvider>");
  return value;
}
