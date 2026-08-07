import { createHmac, timingSafeEqual } from "crypto";

/**
 * La ficha de silla: el permiso para jugar UNA mesa, y nada más.
 *
 * No es una sesión y es importante que no lo parezca. Una sesión dice quién
 * eres y sirve para todo; esta ficha dice "esta dirección probó ser la dueña de
 * esta silla" y no sirve para nada fuera de esa mesa. Tres candados, a
 * propósito:
 *
 *   1. **Atada a la mesa.** Lleva el identificador dentro y se comprueba contra
 *      la sala sobre la que se actúa. La ficha de una mesa no vale en otra,
 *      aunque sea del mismo jugador.
 *   2. **Corta.** Dura lo que dura una sala (dos horas), no treinta días. Es el
 *      máximo útil: menos echaría al jugador de su propia silla pagada a mitad
 *      de partida, y más sería regalar tiempo a quien la robe.
 *   3. **Llave distinta.** Se firma con una clave derivada del secreto general,
 *      no con el secreto general. Una ficha de silla no puede convertirse en un
 *      token de sesión ni al revés, ni aunque alguien confunda los caminos:
 *      `requireIdentity` no la reconoce y esto no reconoce las suyas.
 *
 * De dónde sale la prueba está en `seat-secret.ts`: el jugador guardó un
 * secreto antes de pagar y mandó su huella dentro de la transacción. Enseña el
 * secreto una vez, se comprueba contra la huella que quedó en la cadena, y a
 * cambio recibe esta ficha. Así el secreto viaja una sola vez.
 */

/** Lo que vive una sala (`ROOM_TTL_MS`). Más allá no hay silla que ocupar. */
const TTL_MS = 2 * 60 * 60 * 1000;

/** Prefijo propio: que no se confunda con `aw1` (sesión de wallet). */
const PREFIX = "as1";

/**
 * Llave separada, derivada del secreto general con una etiqueta de dominio.
 * Así no hay un segundo secreto que poner en el entorno —una variable más es
 * una variable más que puede faltar en producción, y eso ya pasó— pero las dos
 * firmas siguen siendo incompatibles entre sí.
 */
function seatKey(): Buffer {
  const secret = process.env.WALLET_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Falta WALLET_SESSION_SECRET (mínimo 32 caracteres) en el entorno."
    );
  }
  return createHmac("sha256", secret).update("avispate:arena-seat:v1").digest();
}

/** ¿Se pueden emitir fichas de silla? Para responder 503 en vez de reventar. */
export function seatTokensEnabled(): boolean {
  const secret = process.env.WALLET_SESSION_SECRET;
  return Boolean(secret && secret.length >= 32);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", seatKey()).update(payload).digest());
}

export interface SeatClaims {
  /** Mesa a la que pertenece la silla. */
  tableId: string;
  /** Dirección que pagó, en minúsculas. */
  address: string;
}

/** Emite la ficha para una silla ya comprobada contra la cadena. */
export function signSeatToken(
  claims: SeatClaims,
  now = Date.now()
): string {
  const payload = b64url(
    JSON.stringify({
      t: claims.tableId.toLowerCase(),
      a: claims.address.toLowerCase(),
      e: now + TTL_MS,
    })
  );
  return `${PREFIX}.${payload}.${sign(payload)}`;
}

/**
 * Verifica la ficha y devuelve a qué mesa y a qué dirección da acceso, o null.
 *
 * Quien llama TIENE que comprobar que `tableId` es la mesa sobre la que se está
 * actuando. Devolverlo en vez de recibirlo es deliberado: obliga a mirarlo.
 */
export function verifySeatToken(
  token: string,
  now = Date.now()
): SeatClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, payload, signature] = parts;

  const expected = fromB64url(sign(payload));
  const given = fromB64url(signature);
  // Comparación en tiempo constante, igual que en las sesiones de wallet: `===`
  // filtra byte a byte cuánto acertó quien está adivinando la firma.
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  try {
    const claims = JSON.parse(fromB64url(payload).toString()) as {
      t?: string;
      a?: string;
      e?: number;
    };
    if (
      typeof claims.t !== "string" ||
      typeof claims.a !== "string" ||
      typeof claims.e !== "number"
    ) {
      return null;
    }
    if (claims.e <= now) return null;
    return { tableId: claims.t.toLowerCase(), address: claims.a.toLowerCase() };
  } catch {
    return null;
  }
}

/** ¿Esto tiene pinta de ficha de silla? Para no mandarla por el camino de Privy. */
export function looksLikeSeatToken(token: string): boolean {
  return token.startsWith(`${PREFIX}.`);
}
