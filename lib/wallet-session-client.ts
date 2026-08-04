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

/** Lee el `exp` del token sin verificarlo: el servidor es quien de verdad valida. */
function readExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { e?: number };
    return typeof claims.e === "number" ? claims.e : 0;
  } catch {
    return 0;
  }
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
    return stored;
  } catch {
    return null;
  }
}

export function clearWalletSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
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

  try {
    const res = await fetch("/api/session/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, txHash }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { token?: string; address?: string };
    if (!data.token || !data.address) return false;

    const stored: StoredSession = {
      token: data.token,
      address: data.address.toLowerCase(),
      expiresAt: readExpiry(data.token),
    };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    window.dispatchEvent(new Event(WALLET_SESSION_EVENT));
    return true;
  } catch {
    return false;
  }
}
