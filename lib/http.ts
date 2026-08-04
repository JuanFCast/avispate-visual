import { NextResponse } from "next/server";
import { verifyPrivyToken } from "./privy-server";
import type { AppIdentity } from "./identity";
import { looksLikeWalletSession, verifyWalletSession } from "./wallet-session";

/** Extrae el token `Authorization: Bearer <token>` de la petición. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Resuelve el token a una identidad, sea de la puerta que sea: los de wallet se
 * reconocen por su prefijo y se verifican aquí mismo (HMAC local, sin red); el
 * resto va a Privy. Devuelve null si no vale.
 */
async function identityFromToken(token: string): Promise<AppIdentity | null> {
  if (looksLikeWalletSession(token)) {
    const address = verifyWalletSession(token);
    return address ? { privyId: null, walletAddress: address } : null;
  }
  try {
    return await verifyPrivyToken(token);
  } catch {
    return null;
  }
}

/**
 * Verifica la sesión de la petición. Devuelve la identidad o una respuesta 401
 * lista para retornar.
 */
export async function requireIdentity(
  req: Request
): Promise<{ identity: AppIdentity } | { response: NextResponse }> {
  const token = bearerToken(req);
  if (!token) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const identity = await identityFromToken(token);
  if (!identity) {
    return { response: NextResponse.json({ error: "invalid_token" }, { status: 401 }) };
  }
  return { identity };
}

/**
 * La identidad si viene y es válida; `null` si no. Para rutas que responden
 * igual a un desconocido y a un jugador, solo que con más detalle al segundo:
 * el estado de una sala privada se puede mirar con el código en la mano, y
 * pedir sesión para eso rompería el enlace que se comparte por chat.
 */
export async function optionalIdentity(req: Request): Promise<AppIdentity | null> {
  const token = bearerToken(req);
  if (!token) return null;
  return await identityFromToken(token);
}
