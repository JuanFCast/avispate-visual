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
  /**
   * La carga del perfil FALLÓ. Distinto de "cargado y vacío", y esa distinción
   * es la que faltaba: antes un fallo se guardaba como `EMPTY` —alias null,
   * wallet null— y quedaba indistinguible de un jugador nuevo. A quien tenía
   * alias y wallet de siempre se le pedía alias, y el guardián de pago se
   * apagaba porque leía `walletAddress: null` como "no tiene ninguna".
   */
  failed: boolean;
  /**
   * Este perfil corresponde a la sesión que hay AHORA.
   *
   * Sin esto había una ventana de un render con la respuesta equivocada: al
   * firmar, `authenticated` pasa a true en el acto, pero el estado sigue siendo
   * el vacío de cuando no había sesión — con `loading: false`. Ese render dice
   * "autenticado, terminó de cargar, sin alias", que es un jugador nuevo. De ahí
   * el parpadeo del formulario de alias a quien ya tiene uno.
   *
   * `refresh` corre en un efecto, o sea DESPUÉS de pintar, así que no llega a
   * tiempo de evitarlo. Esto sí, porque se mira en el mismo render.
   */
  fetched: boolean;
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

/** Sin sesión: no hay perfil, y eso SÍ se sabe. */
const EMPTY: ProfileState = {
  loading: false,
  failed: false,
  // Sin sesión no hay nada que traer, pero tampoco corresponde a ninguna: si
  // aparece una, este perfil deja de valer y hay que volver a preguntar.
  fetched: false,
  alias: null,
  walletAddress: null,
};

/**
 * Había sesión y el perfil no se pudo cargar. No es lo mismo que vacío.
 * `fetched: true` porque SÍ se preguntó: lo que falta no es la respuesta, es
 * que la respuesta sirva. Si no, se quedaría cargando para siempre.
 */
const FAILED: ProfileState = { ...EMPTY, failed: true, fetched: true };

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
    // Hay sesión pero no se pudo sacar el token: tampoco se sabe nada del
    // perfil. Es un fallo, no un perfil vacío.
    if (!token) {
      setState(FAILED);
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
        failed: false,
        fetched: true,
        alias: data.alias ?? null,
        walletAddress: data.walletAddress ?? null,
      });
    } catch {
      setState(FAILED);
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

  /**
   * "Cargando" incluye el hueco entre firmar y pedir el perfil.
   *
   * Va DESPUÉS del `...state` a propósito: si el jugador tiene sesión y lo que
   * hay guardado no se trajo para ella, todavía no sabemos nada de él — aunque
   * el estado diga `loading: false` porque venía de cuando no había sesión.
   * Ese render era el del parpadeo del alias.
   */
  const loading = state.loading || (authenticated && !state.fetched);

  return (
    <ProfileContext.Provider
      value={{
        ...state,
        loading,
        ready,
        authenticated,
        refresh,
        setAlias,
        getToken,
      }}
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
