"use client";

/**
 * Transporte de los envíos que NO se pueden perder (el recibo de una jugada
 * cobrada y el resultado de la partida). La persistencia vive en `outbox.ts`;
 * aquí solo está el POST con reintentos y, sobre todo, la decisión de si vale
 * la pena volver a intentarlo.
 *
 * Los dos endpoints son idempotentes por `tx_hash` / `client_game_id`, así que
 * reintentar es seguro: repetir el envío nunca duplica una jugada ni cobra de
 * nuevo.
 */

/** Qué pasó con el envío, desde el punto de vista de quién lo guarda. */
export type SendResult =
  /** El servidor lo aceptó (o ya lo tenía). Se puede borrar. */
  | "ok"
  /** Rechazo definitivo: insistir no va a cambiar nada. Se puede borrar. */
  | "rejected"
  /** Falló por algo pasajero. Hay que guardarlo y volver a intentar. */
  | "retry";

/**
 * Errores del servidor que valen un reintento. `invalid_payment` está aquí a
 * propósito: casi siempre significa "todavía no veo esa transacción", no
 * "esa transacción no existe" — el nodo de Celo del servidor va unos segundos
 * detrás del que confirmó la transacción en el teléfono.
 */
const RETRYABLE_ERRORS = new Set(["invalid_payment", "server_error"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Un intento suelto. */
async function postOnce(url: string, body: unknown): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return "ok";

    // 5xx y 429: el servidor está mal o saturado, no la petición.
    if (res.status >= 500 || res.status === 429) return "retry";

    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (data?.error && RETRYABLE_ERRORS.has(data.error)) return "retry";

    return "rejected";
  } catch {
    // Sin red, petición abortada, pestaña suspendida a mitad del envío.
    return "retry";
  }
}

/**
 * POST con reintentos silenciosos. `delays` define cuántos intentos hay y
 * cuánto se espera entre ellos, porque no es lo mismo el envío que retiene al
 * jugador antes del 3, 2, 1 que el reenvío de fondo al abrir la app.
 */
export async function postWithRetry(
  url: string,
  body: unknown,
  delays: readonly number[]
): Promise<SendResult> {
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    const result = await postOnce(url, body);
    if (result !== "retry") return result;
  }
  return "retry";
}
