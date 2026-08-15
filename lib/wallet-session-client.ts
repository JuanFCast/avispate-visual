"use client";

/**
 * El lado del navegador de la sesión sin firma (ver `wallet-session.ts`).
 *
 * Dentro de MiniPay no hay pantalla de "entrar": el jugador abre el Mini App y
 * juega. La sesión nace sola de esa primera jugada —que es on-chain incluso
 * cuando es gratis— y de ahí en adelante el perfil, el alias y la Arena
 * funcionan igual que con correo.
 */

const KEY = "avispate.wallet-session";

/** Aviso a la app de que acaba de haber sesión nueva (lo oye ProfileProvider). */
export const WALLET_SESSION_EVENT = "avispate:wallet-session";

interface StoredSession {
  token: string;
  address: string;
  /** Vencimiento en ms, leído del propio token para no pedirle nada al servidor. */
  expiresAt: number;
}

/**
 * Lee las afirmaciones del token sin verificarlo: el servidor es quien de
 * verdad valida (`verifyWalletSession`, HMAC con `WALLET_SESSION_SECRET`).
 *
 * Aquí solo se DECODIFICA la parte que el servidor firmó — `a` (la dirección) y
 * `e` (el vencimiento)—, y eso importa para `a`: es la dirección que el
 * servidor emitió DESPUÉS de comprobar en la cadena que esa wallet firmó una
 * transacción nuestra. Manipularla en el navegador no engaña a nadie: el token
 * deja de cuadrar con su firma y el servidor lo rechaza en la siguiente
 * llamada. Por eso se lee de aquí y no del campo `address` guardado al lado,
 * que sí es JSON que escribió el propio cliente.
 */
function readClaims(token: string): { address: string | null; expiresAt: number } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { a?: string; e?: number };
    return {
      address: typeof claims.a === "string" ? claims.a.toLowerCase() : null,
      expiresAt: typeof claims.e === "number" ? claims.e : 0,
    };
  } catch {
    return { address: null, expiresAt: 0 };
  }
}

/**
 * La dirección CANÓNICA según la sesión de wallet, o `null` si no hay sesión
 * viva. Es la segunda fuente de `canonicalFromProfile`: cuando `/api/profile`
 * tarda, falla o vuelve incompleto, esto sigue sabiendo de quién es la cuenta,
 * y saberlo es lo que permite seguir jugando sin cerrar sesión.
 */
export function walletSessionAddress(): string | null {
  const stored = readWalletSession();
  if (!stored) return null;
  return readClaims(stored.token).address;
}

/**
 * La sesión guardada, si sigue viva. `localStorage` y no `sessionStorage`: la
 * webview de MiniPay limpia el de sesión en cada reapertura, y volver a pedir
 * una jugada solo para recuperar el perfil sería absurdo.
 */
export function readWalletSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.token || !stored.address) return null;
    if (stored.expiresAt <= Date.now()) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    // El vencimiento que manda es el FIRMADO, no el que se guardó al lado: un
    // `expiresAt` editado a mano no puede alargar una sesión vencida.
    if (readClaims(stored.token).expiresAt <= Date.now()) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function clearWalletSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  // No basta con borrar el almacenamiento: `ProfileProvider` conserva en
  // memoria si había sesión. Sin avisarle, un token inválido deja la app
  // creyendo que el jugador sigue autenticado hasta la próxima recarga.
  window.dispatchEvent(new Event(WALLET_SESSION_EVENT));
}

/**
 * Canjea el hash de una jugada por sesión, si hace falta. No hace nada si ya
 * hay una viva para esa misma wallet — el canje es de un solo uso y gastarlo
 * cuando ya se tiene sesión solo quema el hash.
 *
 * Nunca lanza: esto corre pegado a una jugada que YA se cobró en la cadena, y
 * un fallo de red aquí no puede tumbar el resultado de la partida. Si falla, la
 * siguiente jugada vuelve a intentarlo.
 */
export async function ensureWalletSession(
  address: string,
  txHash: string
): Promise<boolean> {
  const current = readWalletSession();
  if (current && current.address === address.toLowerCase()) return true;

  for (let intento = 0; intento <= CANJE_DELAYS.length; intento++) {
    if (intento > 0) await dormir(CANJE_DELAYS[intento - 1]);
    const resultado = await canjearUnaVez(address, txHash);
    if (resultado !== "reintentar") return resultado === "ok";
  }
  return false;
}

/**
 * Reintentos del canje, y por qué existen.
 *
 * Esto corre pegado a la transacción recién confirmada, que es el PEOR momento
 * para preguntarle al servidor: su nodo de Celo va unos cientos de milisegundos
 * por detrás del que confirmó la transacción en el teléfono. Sin reintentos, el
 * canje pedía el recibo antes de que existiera, `verifyWalletControl` no lo
 * encontraba y devolvía 403 — el caso real medido el 2026-08-15: transacción
 * minada a las 03:04:36.000Z y canje a las 03:04:36.57, 570 ms después.
 *
 * `/api/plays` nunca sufrió esto porque va por la bandeja, que reintenta. El
 * canje se rendía al primer intento, así que DENTRO DE MINIPAY —donde la sesión
 * de wallet es la única que hay— no se creaba ninguna: sin ella no hay perfil,
 * ni alias propio, ni Arena, y el jugador se queda con lo mínimo.
 *
 * Los tiempos son cortos a propósito: no bloquean nada (el canje es
 * `void`-eado desde `pay.ts` y la partida ya arrancó), y con esto se cubre de
 * sobra el retraso que se ha medido.
 */
const CANJE_DELAYS = [800, 2000, 5000] as const;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Un intento de canje.
 *
 * "reintentar" es solo para lo que de verdad cambia con el tiempo: que el nodo
 * todavía no vea la transacción (403 `tx_not_valid`) o que la red falle. Un
 * hash ya gastado (409) o el login de wallet apagado (503) no mejoran
 * esperando, así que se abandona en el acto.
 */
async function canjearUnaVez(
  address: string,
  txHash: string
): Promise<"ok" | "reintentar" | "no"> {
  try {
    const res = await fetch("/api/session/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, txHash }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      // El nodo del servidor va detrás: exactamente lo que hay que reintentar.
      if (res.status === 403 && data?.error === "tx_not_valid") return "reintentar";
      if (res.status >= 500) return "reintentar";
      return "no";
    }

    const data = (await res.json()) as { token?: string; address?: string };
    if (!data.token || !data.address) return "no";

    const stored: StoredSession = {
      token: data.token,
      address: data.address.toLowerCase(),
      expiresAt: readClaims(data.token).expiresAt,
    };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    window.dispatchEvent(new Event(WALLET_SESSION_EVENT));
    return "ok";
  } catch {
    // Sin red, o la webview suspendida a mitad del envío.
    return "reintentar";
  }
}
