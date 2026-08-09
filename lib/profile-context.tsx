"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  readWalletSession,
  WALLET_SESSION_EVENT,
} from "./wallet-session-client";
import { SETTLE_LIMIT_MS } from "./wallet-identity";

interface ProfileState {
  /** Aún cargando el perfil del servidor. */
  loading: boolean;
  /** Alias del jugador, o null si todavía no lo eligió. */
  alias: string | null;
  /** Wallet embebida en minúsculas, o null. */
  walletAddress: string | null;
}

interface ProfileContextValue extends ProfileState {
  /** Ya sabemos si hay sesión o no, venga de donde venga. */
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
  const { ready: privyReady, authenticated: privyAuth, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
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
   * "Ya sabemos si hay sesión", y no "Privy terminó de arrancar".
   *
   * Eran lo mismo hasta que apareció la sesión de wallet, y entonces dejó de
   * serlo sin que nadie lo notara: dentro de MiniPay el jugador tiene sesión
   * válida en `localStorage` y aun así toda la app se quedaba esperando a un
   * SDK que ahí no usa para nada. Los botones colgaban de este valor, así que
   * el efecto visible era el peor posible — tocar y que no pasara nada.
   *
   * Con sesión de wallet ya está contestada la pregunta y no hay a quién
   * esperar. Sin ella sí hay que esperar a Privy, que es quien sabe.
   */
  /**
   * Y esta espera también CADUCA.
   *
   * Si Privy no termina de arrancar —red mala, SDK atascado— `ready` se quedaba
   * en falso para siempre y toda la app colgando de él: el lobby en
   * "Preparando…" sin botón que tocar. Pasado el tope se da por contestada la
   * pregunta con lo que se sabe (no hay sesión) y el jugador recupera el botón
   * de entrar. Si Privy aparece luego, esto vuelve a true y la pantalla se
   * corrige sola.
   */
  const [privyTimedOut, setPrivyTimedOut] = useState(false);
  useEffect(() => {
    if (privyReady) {
      setPrivyTimedOut(false);
      return;
    }
    const t = setTimeout(() => setPrivyTimedOut(true), SETTLE_LIMIT_MS);
    return () => clearTimeout(t);
  }, [privyReady]);

  const ready = walletSession || privyReady || privyTimedOut;

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

  /**
   * La wallet embebida de Privy no existe en el instante del login: se crea
   * unos segundos después. Esa dirección es la que el servidor anota en el
   * perfil, así que hay que volver a preguntar cuando aparece.
   *
   * No es un detalle cosmético. Sin esta relectura el perfil se queda para
   * siempre sin dirección, la primera jugada —que llega identificada por la
   * wallet— no encuentra a nadie con ella y le abre al jugador un SEGUNDO
   * perfil. De ahí salían el alias que "se perdía" al volver a entrar y el
   * "ese nombre ya está registrado" contra uno mismo.
   */
  const embeddedWallet =
    wallets.find((w) => w.walletClientType === "privy")?.address ?? null;

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, authenticated, embeddedWallet, refresh]);

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
