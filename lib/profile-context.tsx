"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  clearWalletSession,
  readWalletSession,
  WALLET_SESSION_EVENT,
} from "./wallet-session-client";
import { SETTLE_LIMIT_MS } from "./wallet-identity";
import {
  callWithTimeout,
  createSequenceGate,
  createSingleFlight,
  decideProfileRefreshAction,
  fetchProfileWithTimeout,
  PROFILE_REQUEST_TIMEOUT_MS,
  PROFILE_SETTLE_LIMIT_MS,
  TOKEN_REQUEST_TIMEOUT_MS,
} from "./profile-recovery";

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

/**
 * Lo que ve el panel de `?debugProfile=1`. TEMPORAL — se quita entero cuando
 * se cierre el diagnóstico del congelamiento.
 *
 * Nada de esto es un secreto: son estados y contadores. Jamás lleva el token,
 * la cookie ni la dirección completa — quien pinta el panel abrevia, y aquí
 * solo viajan códigos de estado y números.
 */
export interface ProfileDebugSnapshot {
  /** Veces que `refresh()` ha arrancado desde que se montó el proveedor. */
  refreshCount: number;
  /** Número vivo del `sequenceGate`. Si sube solo, hay bucle. */
  sequence: number;
  /** En qué quedó pedir el token: pending / ok / timeout / error / none. */
  lastToken: string;
  /** En qué quedó `/api/profile`: pending / 200 / 401 / 500 / timeout / … */
  lastFetch: string;
  /** Qué se publicó por última vez, y si el gate lo descartó. */
  lastPublish: string;
  /** Cuántas respuestas descartó el gate por "ya no eres la actual". */
  discarded: number;
  /** `state.loading` CRUDO, para distinguirlo del derivado. */
  rawLoading: boolean;
  /** ¿Hay sesión de wallet guardada? Solo sí/no — nunca el token. */
  walletSession: boolean;
}

interface ProfileContextValue extends ProfileState {
  /** Ya sabemos si hay sesión o no, venga de donde venga. */
  ready: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
  setAlias: (alias: string) => Promise<{ ok: boolean; error?: string }>;
  /** Token de acceso de Privy para llamar a las rutas protegidas. */
  getToken: () => Promise<string | null>;
  /**
   * TEMPORAL: la foto para `?debugProfile=1`. Se lee bajo demanda (el panel
   * consulta cada poco) en vez de vivir en el estado, para que instrumentar
   * esto no le cueste un render a nadie que no esté depurando.
   */
  readDebug: () => ProfileDebugSnapshot;
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
  // Solo la consulta más reciente puede publicar su respuesta. Al cambiar de
  // sesión o reintentar, una respuesta vieja no debe volver a poner el perfil
  // anterior encima del actual. Ver `lib/profile-recovery.ts`.
  const sequenceGate = useRef(createSequenceGate());
  /**
   * TEMPORAL (`?debugProfile=1`): contadores de solo observación.
   *
   * En un `ref` a propósito: escribir aquí no dispara renders, así que la
   * instrumentación no puede alterar lo que intenta medir ni costarle nada a
   * quien no está depurando.
   */
  const dbg = useRef({
    refreshCount: 0,
    lastToken: "idle",
    lastFetch: "idle",
    lastPublish: "idle",
    discarded: 0,
  });
  /** Una consulta a la vez; las solapadas se coalescen. Ver `SingleFlight`. */
  const flight = useRef(createSingleFlight());
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

  /**
   * La sesión VIVA, no la que se capturó cuando se creó la función.
   *
   * Este es el bug que el panel destapó. `refresh` cerraba sobre
   * `authenticated`, y `wallet-auth.ts` hace `await refresh()` justo después
   * de `loginWithSiwe()`: la función que se ejecuta es la del render del
   * CLIC, o sea la de cuando todavía no había sesión. Entraba por
   * `if (!authenticated) publish(EMPTY)` —sin tocar la red, así que
   * instantánea— le ganaba la carrera a los fetches en vuelo, y dejaba el
   * perfil en `{fetched:false, failed:false}` con la sesión ya abierta:
   * cargando para siempre.
   *
   * Leyéndolo de un ref, un `refresh()` disparado DESPUÉS de firmar ya no
   * puede creer que no hay sesión. De paso `refresh` queda estable.
   */
  const authRef = useRef(authenticated);
  const privyAuthRef = useRef(privyAuth);
  const getTokenRef = useRef(getToken);
  // Declarado ANTES del efecto que llama a `refresh`, para que en el mismo
  // commit los refs ya estén al día cuando ese efecto corra.
  useEffect(() => {
    authRef.current = authenticated;
    privyAuthRef.current = privyAuth;
    getTokenRef.current = getToken;
  });

  const runRefresh = useCallback(async () => {
    const authenticated = authRef.current;
    const privyAuth = privyAuthRef.current;
    const getToken = getTokenRef.current;
    const sequence = sequenceGate.current.begin();
    dbg.current.refreshCount += 1;
    /**
     * `etiqueta` es TEMPORAL (`?debugProfile=1`) y no cambia la decisión: el
     * `if` es el mismo de siempre, solo se anota qué salió por él. Es el dato
     * que faltaba — si el gate está descartando publicaciones, aquí se ve.
     */
    const publish = (next: ProfileState, etiqueta: string) => {
      if (sequenceGate.current.isCurrent(sequence)) {
        dbg.current.lastPublish = etiqueta;
        setState(next);
      } else {
        dbg.current.discarded += 1;
        dbg.current.lastPublish = `${etiqueta} DESCARTADO`;
      }
    };

    if (!authenticated) {
      publish(EMPTY, "EMPTY (sin sesion)");
      return;
    }
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    /**
     * Con tope de tiempo, y este era el agujero.
     *
     * `fetchProfileWithTimeout` (más abajo) acotaba la petición del perfil,
     * pero esta espera —el SDK de Privy hablando con su iframe— no tenía
     * ninguno. Colgada aquí, `refresh()` no llegaba nunca a `publish()`, así
     * que `loading` se quedaba en true PARA SIEMPRE: el lobby en "Comprobando
     * tu entrada…", el modal en "Comprobando tu perfil…" y el botón de jugar
     * muerto, sin más salida que recargar.
     *
     * Vencido el plazo se trata como fallo, que es lo honesto —no sabemos
     * quién es— y encima es RECUPERABLE: el lobby ofrece "reintentar" con
     * `profile.failed`, mientras que "cargando" no ofrece nada.
     */
    dbg.current.lastToken = "pending";
    const attempt = await callWithTimeout(getToken, TOKEN_REQUEST_TIMEOUT_MS);
    const token = attempt.kind === "ok" ? attempt.value : null;
    dbg.current.lastToken =
      attempt.kind === "ok" ? (token ? "ok" : "none") : attempt.kind;
    // Hay sesión pero no se pudo sacar el token: tampoco se sabe nada del
    // perfil. Es un fallo, no un perfil vacío.
    if (!token) {
      publish(FAILED, "FAILED (sin token)");
      return;
    }

    // Recordamos de qué puerta salió el token. Si el servidor invalida una
    // sesión de wallet (por ejemplo, después de rotar el secreto), conservarla
    // 30 días en localStorage crea un bucle imposible de arreglar desde la UI.
    const walletSession = readWalletSession();
    const usingWalletSession = walletSession?.token === token;

    // `fetchProfileWithTimeout` SIEMPRE resuelve, colgada o no: es lo que
    // garantiza que `loading` nunca se quede pegado en `true`. La decisión de
    // qué hacer con el resultado —éxito, sesión inválida, o fallo recuperable—
    // es pura y vive en `lib/profile-recovery.ts`, donde se puede probar sin
    // un navegador.
    dbg.current.lastFetch = "pending";
    const outcome = await fetchProfileWithTimeout(
      (signal) =>
        fetch("/api/profile", {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        }),
      PROFILE_REQUEST_TIMEOUT_MS
    );
    dbg.current.lastFetch =
      outcome.kind === "ok" ? String(outcome.response.status) : outcome.kind;
    const action = decideProfileRefreshAction(outcome, { usingWalletSession });

    if (action.kind === "clear_invalid_session") {
      // Volvemos de inmediato al camino wallet-only. La siguiente jugada
      // confirmada emitirá una sesión nueva; no hace falta borrar alias,
      // historial ni ninguna transacción.
      clearWalletSession();
      /**
       * Y aquí estaba el cuelgue de verdad.
       *
       * `EMPTY` lleva `fetched: false` —"no se ha preguntado"— y eso es cierto
       * solo cuando NO hay sesión: por eso la rama de arriba puede usarlo sin
       * daño. Con sesión de Privy viva, tirar la ficha de wallet vencida no
       * borra la identidad: `authenticated` sigue en true, y entonces
       * `loading` (que es `state.loading || (authenticated && !fetched)`) se
       * queda en TRUE PARA SIEMPRE. Nada vuelve a disparar el efecto, porque
       * ni `ready` ni `authenticated` ni la wallet embebida cambiaron.
       *
       * Se llega con más facilidad de la que parece: si `getAccessToken()` de
       * Privy devuelve vacío —token vencido, iframe tocado—, `getToken()` cae
       * al token de wallet guardado, que puede ser de hace semanas; el
       * servidor lo rechaza con 401 y aterrizamos justo aquí. Un navegador que
       * probó MiniPay y además tiene cuenta de correo reúne las dos mitades.
       *
       * `FAILED` dice lo mismo sin mentir —no sabemos quién eres— y además es
       * RECUPERABLE: el lobby pinta "reintentar" para `profile.failed`, y ese
       * toque vuelve a pedir el token, ya sin la ficha vencida de por medio.
       */
      publish(
        privyAuth ? FAILED : EMPTY,
        privyAuth ? "FAILED (sesion wallet invalida)" : "EMPTY (sesion wallet invalida)"
      );
      return;
    }
    if (action.kind === "failed") {
      publish(FAILED, `FAILED (${dbg.current.lastFetch})`);
      return;
    }
    try {
      const data = await (outcome as { kind: "ok"; response: Response }).response.json();
      publish(
        {
          loading: false,
          failed: false,
          fetched: true,
          alias: data.alias ?? null,
          walletAddress: data.walletAddress ?? null,
        },
        "OK"
      );
    } catch {
      publish(FAILED, "FAILED (json ilegible)");
    }
  }, []);

  /**
   * Lo que ve el resto de la app. Coalesce en vez de competir: dos llamadas
   * solapadas ya no se invalidan la respuesta entre ellas.
   */
  const refresh = useCallback(
    () => flight.current.run(runRefresh),
    [runRefresh]
  );

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

  /**
   * El `refresh` más reciente, alcanzable sin que su IDENTIDAD dispare nada.
   *
   * Este efecto colgaba de `refresh`, que cuelga de `getToken`, que cuelga de
   * `getAccessToken` de Privy. Si el SDK devuelve una función nueva en cada
   * render —y no promete lo contrario—, el efecto corría en CADA render:
   * `sequenceGate.begin()` subía el número cada vez, así que la respuesta que
   * estaba llegando se descartaba siempre por "ya no eres la actual" y
   * `publish()` no se ejecutaba nunca. El perfil se quedaba cargando para
   * siempre sin que fallara ni una sola petición, que es justo lo que hace
   * este fallo tan difícil de ver: en la pestaña de red todo sale 200.
   *
   * Con el ref, el efecto depende solo de lo que de verdad cambia el
   * resultado —hay sesión, cuál, y qué wallet embebida hay— y siempre llama a
   * la versión buena. Es el mismo patrón que ya usa `arena-match-client.ts`.
   */
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    if (!ready) return;
    refreshRef.current();
  }, [ready, authenticated, embeddedWallet]);

  /**
   * "Cargando" CADUCA — el seguro que no depende de acertar la causa.
   *
   * Tres veces seguidas se arregló una puerta distinta y la pantalla se quedó
   * igual de muerta por la siguiente. Esto no arregla ninguna: garantiza que
   * el jugador acabe SIEMPRE con un botón. `failed` es recuperable de un
   * toque (`profile.refresh()`), así que equivocarse por este lado cuesta un
   * toque; por el otro cuesta la partida.
   */
  const stuck = authenticated && (state.loading || !state.fetched);
  useEffect(() => {
    if (!stuck) return;
    const timer = setTimeout(() => {
      // `sequenceGate` no se toca: si la consulta de verdad llega después,
      // sigue siendo la actual y pisa esto con la respuesta buena.
      setState((s) => (s.fetched && !s.loading ? s : FAILED));
    }, PROFILE_SETTLE_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [stuck]);

  const setAlias = useCallback(
    async (alias: string) => {
      // Mismo tope y por lo mismo: sin él, un SDK mudo deja el formulario de
      // nombre girando sin decir nada. Aquí el fallo sí es contable —
      // "no_session" ya tiene su mensaje— así que además se puede reintentar.
      const attempt = await callWithTimeout(getToken, TOKEN_REQUEST_TIMEOUT_MS);
      const token = attempt.kind === "ok" ? attempt.value : null;
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

  /**
   * TEMPORAL (`?debugProfile=1`). Se lee bajo demanda, nunca vive en el
   * estado: así el panel no participa del ciclo de renders que está midiendo.
   */
  const readDebug = useCallback(
    (): ProfileDebugSnapshot => ({
      ...dbg.current,
      sequence: sequenceGate.current.current(),
      rawLoading: state.loading,
      walletSession: Boolean(readWalletSession()),
    }),
    [state.loading]
  );

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
        readDebug,
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
