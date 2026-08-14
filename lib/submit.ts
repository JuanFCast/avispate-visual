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
 *
 * Los dos de alias también, y por una razón concreta: `/api/scores` los devuelve
 * cuando la wallet aún no tiene nombre, pero deja de pedirlo en cuanto lo tenga.
 * Tratarlos como rechazo definitivo BORRABA una partida ya pagada — así se
 * perdieron las dos de Juan el 2026-08-07. Guardado, el envío se reintenta al
 * abrir la app y entra solo apenas el jugador elige un alias válido.
 */
const RETRYABLE_ERRORS = new Set([
  "invalid_payment",
  "server_error",
  "alias_required",
  "alias_taken",
  // Pagó una dirección distinta a la que dijo el navegador. Se conserva a
  // propósito: mientras el envío siga en la bandeja, la pantalla no ofrece
  // jugar y por tanto NO puede haber un segundo cobro. Se resuelve cuando la
  // persona conecta la wallet que pagó de verdad.
  "payer_mismatch",
]);

/** Resultado del envío, con el motivo del servidor cuando lo dio. */
export interface SendOutcome {
  result: SendResult;
  /** Código de error del servidor (`payer_mismatch`, `alias_taken`…). */
  error?: string;
  /**
   * Con `payer_mismatch`, la dirección que pagó DE VERDAD según la cadena. Se
   * enseña para que la persona la reconozca; la reconciliación la hace ella
   * conectando esa wallet, nunca la app por su cuenta.
   */
  payer?: string;
  /**
   * Cuerpo de la respuesta cuando el servidor aceptó el envío. Hoy solo lo usa
   * `/api/plays` (la semilla del mazo que hay que jugar); el resto de
   * llamantes lo ignora sin problema.
   */
  data?: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Un intento suelto. */
async function postOnce(url: string, body: unknown): Promise<SendOutcome> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      return { result: "ok", data: data ?? undefined };
    }

    // 5xx y 429: el servidor está mal o saturado, no la petición.
    if (res.status >= 500 || res.status === 429) return { result: "retry" };

    const data = (await res.json().catch(() => null)) as {
      error?: string;
      payer?: string;
    } | null;
    if (data?.error && RETRYABLE_ERRORS.has(data.error)) {
      return { result: "retry", error: data.error, payer: data.payer };
    }

    return { result: "rejected", error: data?.error, payer: data?.payer };
  } catch {
    // Sin red, petición abortada, pestaña suspendida a mitad del envío.
    return { result: "retry" };
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
): Promise<SendOutcome> {
  let last: SendOutcome = { result: "retry" };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    last = await postOnce(url, body);
    if (last.result !== "retry") return last;
  }
  return last;
}
