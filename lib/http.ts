import { NextResponse } from "next/server";
import { verifyPrivyToken, type PrivyIdentity } from "./privy-server";

/** Extrae el token `Authorization: Bearer <token>` de la petición. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Verifica el token de Privy de la petición. Devuelve la identidad o una
 * respuesta 401 lista para retornar.
 */
export async function requireIdentity(
  req: Request
): Promise<{ identity: PrivyIdentity } | { response: NextResponse }> {
  const token = bearerToken(req);
  if (!token) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  try {
    const identity = await verifyPrivyToken(token);
    return { identity };
  } catch {
    return { response: NextResponse.json({ error: "invalid_token" }, { status: 401 }) };
  }
}

/**
 * La identidad si viene y es válida; `null` si no. Para rutas que responden
 * igual a un desconocido y a un jugador, solo que con más detalle al segundo:
 * el estado de una sala privada se puede mirar con el código en la mano, y
 * pedir sesión para eso rompería el enlace que se comparte por chat.
 */
export async function optionalIdentity(req: Request): Promise<PrivyIdentity | null> {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    return await verifyPrivyToken(token);
  } catch {
    return null;
  }
}
