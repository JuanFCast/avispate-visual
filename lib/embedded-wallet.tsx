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
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount, useConnect } from "wagmi";
import { useProfile } from "./profile-context";
import { useIsMiniPay } from "./minipay";
import { decideEmbeddedCreation } from "./wallet-identity";

/**
 * La wallet embebida de Privy, desde que el jugador entra con su correo hasta
 * que wagmi puede firmar con ella.
 *
 * Ese tramo tiene dos pasos y los dos podían quedarse colgados sin que nadie se
 * enterara: Privy tarda unos segundos en CREAR la wallet, y luego wagmi tiene
 * que CONECTARLA. Antes se intentaba conectar una sola vez y, si ese intento
 * caía en el hueco (el conector aún no existía, el proveedor contestó tarde),
 * no había segundo intento: el botón de jugar se quedaba en "Preparando…" para
 * siempre y la única salida era recargar la página. Fue justo lo que le pasó al
 * primer jugador que entró desde Chrome.
 *
 * Así que aquí se reintenta, se fuerza la creación si tarda de más, y —lo más
 * importante— el estado se publica para que la pantalla pueda CONTARLO en vez
 * de fingir que está lista.
 */

/** Identidad EIP-6963 con la que anunciamos la embebida a wagmi/RainbowKit. */
export const EMBEDDED_INFO = {
  name: "Avíspate (Privy)",
  rdns: "fun.avispate.embedded",
  icon:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23FFC20E'/%3E%3C/svg%3E",
};

/**
 * Lo que se espera antes de crear la wallet.
 *
 * Eran 6 segundos, y tenían sentido cuando Privy creaba la wallet al entrar y
 * esto era solo un empujón por si se atascaba: había que darle tiempo a llegar
 * antes de pedir una segunda. Desde que `createOnLogin` está apagado, ese margen
 * es tiempo muerto puro — nadie más va a crear nada, y el jugador se queda
 * mirando "Preparando…" seis segundos por nada.
 *
 * Queda una espera corta y por otro motivo: `decideEmbeddedCreation` puede
 * oscilar un instante mientras el perfil se recarga (`loading` sube y baja), y
 * esto absorbe ese parpadeo sin que se note.
 */
const CREATE_GRACE_MS = 400;
/** Entre intentos de conexión. Un bloque de Celo dura ~1 s; esto es de sobra. */
const CONNECT_RETRY_MS = 4_000;
/** A partir de aquí ya no es lentitud: se le ofrece al jugador reintentar. */
const STUCK_MS = 20_000;
/** Tope de reintentos automáticos. Después manda el jugador, no el bucle. */
const MAX_CONNECT_ATTEMPTS = 8;

export type EmbeddedWalletStatus =
  /** No hay sesión de Privy: no hay ninguna wallet que esperar. */
  | "idle"
  /** Privy todavía no ha creado la wallet. */
  | "creating"
  /** La wallet existe; falta que wagmi la conecte. */
  | "connecting"
  /** Lista para firmar. */
  | "ready"
  /** Lleva demasiado tiempo esperando: hay que reintentar a mano. */
  | "stuck"
  /**
   * El jugador entró FIRMANDO con su propia wallet y ahora esa wallet no está
   * conectada. Aquí no hay nada que crear ni que reintentar solo: hay que
   * pedirle que la conecte, porque la firma la da él.
   */
  | "external";

interface EmbeddedWalletValue {
  status: EmbeddedWalletStatus;
  /** Vuelve a intentar crear y conectar. Lo llama el botón de la pantalla. */
  retry: () => void;
}

const EmbeddedWalletContext = createContext<EmbeddedWalletValue>({
  status: "idle",
  retry: () => {},
});

export function useEmbeddedWalletStatus(): EmbeddedWalletValue {
  return useContext(EmbeddedWalletContext);
}

/** Lo que nos interesa de una cuenta enlazada en Privy. */
interface LinkedAccountLike {
  type?: string;
  walletClientType?: string;
  chainType?: string;
}

export function EmbeddedWalletProvider({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  // El perfil, que es quien sabe si esta identidad YA tiene wallet.
  const profile = useProfile();
  // Y dentro de MiniPay la respuesta ya está: su wallet inyectada.
  const inMiniPay = useIsMiniPay();
  const { createWallet } = useCreateWallet();
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const embeddedAddress = embedded?.address ?? null;

  /**
   * Qué wallets tiene ENLAZADAS la cuenta, que no es lo mismo que cuáles están
   * conectadas ahora. La diferencia importa: quien entró firmando con su
   * Binance/MetaMask puede tener la sesión de Privy viva y la wallet
   * desconectada, y si nos guiáramos por lo conectado le crearíamos una wallet
   * embebida que nunca pidió.
   */
  const linkedWallets = ((user?.linkedAccounts ?? []) as LinkedAccountLike[])
    .filter((a) => a.type === "wallet" && a.chainType !== "solana");
  const hasEmbedded =
    Boolean(embedded) ||
    linkedWallets.some((a) => a.walletClientType === "privy");
  const hasExternal = linkedWallets.some(
    (a) => a.walletClientType !== undefined && a.walletClientType !== "privy"
  );
  /** Entró firmando con la suya: no hay wallet embebida que crear ni esperar. */
  const externalOnly = hasExternal && !hasEmbedded;
  /** Ronda de reintento AUTOMÁTICO. Al cambiar, se vuelve a intentar conectar. */
  const [round, setRound] = useState(0);
  /**
   * Reintentos que pidió el jugador. Van aparte de los automáticos porque
   * reinician cosas distintas: el reloj de la paciencia tiene que empezar de
   * cero cuando alguien toca "Reintentar", pero no cada cuatro segundos —
   * si no, nunca se cumpliría la espera y el botón no aparecería jamás.
   */
  const [manual, setManual] = useState(0);
  const [stuck, setStuck] = useState(false);
  const announcedRef = useRef<string | null>(null);
  const createTriedRef = useRef(false);
  const attemptsRef = useRef(0);

  /**
   * Hay sesión y todavía no se puede firmar con nada, y encima es algo que nos
   * toca resolver a nosotros. Con wallet propia no se cuenta el tiempo: ahí no
   * estamos esperando a nadie, estamos esperando al jugador.
   */
  const waiting = privyReady && authenticated && !isConnected && !externalOnly;

  // 1. Anunciar la embebida por EIP-6963 para que wagmi la descubra como una
  //    wallet más, sin reemplazar los conectores externos.
  useEffect(() => {
    if (!embedded || !embeddedAddress) return;
    if (announcedRef.current === embeddedAddress) return;
    let cancelled = false;

    /**
     * El oyente se guarda para poder QUITARLO.
     *
     * Antes la limpieza solo marcaba `cancelled` y el `addEventListener` se
     * quedaba puesto para siempre. Cada vez que este efecto volvía a correr
     * dejaba otra closure viva, y cada una seguía agarrada a su `detail` — o
     * sea a un proveedor viejo. En el siguiente `eip6963:requestProvider` se
     * anunciaban TODOS, incluidos los muertos, y wagmi podía redescubrir y
     * reconectar uno anterior. Con dos wallets en juego eso es exactamente la
     * intermitencia que se veía: a veces salía una dirección y a veces otra.
     */
    let listener: (() => void) | null = null;

    (async () => {
      const provider = await embedded.getEthereumProvider();
      if (cancelled || !provider) return;
      announcedRef.current = embeddedAddress;

      const detail = Object.freeze({
        info: { ...EMBEDDED_INFO, uuid: crypto.randomUUID() },
        provider,
      });
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail })
        );
      listener = announce;
      // Responder tanto a peticiones futuras como anunciar de inmediato.
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    })();

    return () => {
      cancelled = true;
      if (listener) {
        window.removeEventListener("eip6963:requestProvider", listener);
      }
    };
  }, [embedded, embeddedAddress]);

  /**
   * 2. Crear la wallet — y ahora ESTE es el único sitio que la crea.
   *
   * `createOnLogin` está apagado (`wallet-providers.tsx`) porque Privy decidía
   * mirando su propio registro, que no ve el perfil de Avíspate. Aquí sí se ve,
   * y la regla es una identidad, una wallet: si el perfil ya tiene dirección no
   * se crea nada, esté la extensión bloqueada, dormida o sin responder. Eso se
   * arregla desbloqueándola, no estrenando otra.
   *
   * `decideEmbeddedCreation` es pura y está probada aparte; aquí solo se ejecuta
   * lo que decida.
   */
  const creation = decideEmbeddedCreation({
    inMiniPay,
    profileReady: profile.ready && !profile.loading,
    canonical: profile.walletAddress,
    hasEmbedded,
    hasExternal,
  });

  useEffect(() => {
    if (!privyReady || !authenticated || !walletsReady) return;
    if (creation.kind !== "create" || createTriedRef.current) return;
    const timer = setTimeout(() => {
      createTriedRef.current = true;
      // Lanza si ya existe o si hay una creación en curso: las dos son buenas
      // noticias, así que el fallo se ignora a propósito.
      createWallet().catch(() => {});
    }, CREATE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [privyReady, authenticated, walletsReady, creation.kind, manual, createWallet]);

  // 3. Conectar la embebida a wagmi, y volver a intentarlo mientras no lo esté.
  //    El intento único de antes era el origen del cuelgue: si el conector aún
  //    no estaba anunciado, no había segunda oportunidad.
  useEffect(() => {
    if (isConnected || !authenticated) {
      attemptsRef.current = 0;
      return;
    }
    // La wallet propia la conecta su dueño, no nosotros: reintentar contra ella
    // solo abriría modales que nadie pidió.
    if (externalOnly) return;
    // El tope existe para no quedarse reintentando en bucle contra un jugador
    // que desconectó su wallet a propósito. Pasado el tope manda el botón.
    if (attemptsRef.current >= MAX_CONNECT_ATTEMPTS) return;
    attemptsRef.current += 1;

    const connector = connectors.find((c) => c.name === EMBEDDED_INFO.name);
    if (connector) connect({ connector });

    // Sin conector todavía (o el intento no prendió): se reintenta. Cuando
    // conecte, este efecto sale por arriba y no quedan temporizadores vivos.
    const retry = setTimeout(() => setRound((r) => r + 1), CONNECT_RETRY_MS);
    return () => clearTimeout(retry);
  }, [isConnected, authenticated, externalOnly, connectors, connect, round, manual]);

  // 4. El reloj de la paciencia. Se reinicia con cada reintento manual.
  useEffect(() => {
    if (!waiting) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(timer);
  }, [waiting, manual]);

  const retry = useCallback(() => {
    attemptsRef.current = 0;
    createTriedRef.current = false;
    setStuck(false);
    setManual((m) => m + 1);
  }, []);

  const status: EmbeddedWalletStatus = !privyReady || !authenticated
    ? "idle"
    : isConnected
      ? "ready"
      : externalOnly
        ? "external"
        : stuck
          ? "stuck"
          : hasEmbedded
            ? "connecting"
            : "creating";

  return (
    <EmbeddedWalletContext.Provider value={{ status, retry }}>
      {children}
    </EmbeddedWalletContext.Provider>
  );
}
