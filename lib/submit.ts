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
  // Los tres estados en los que la cadena todavía no ha dicho la última
  // palabra. Se conservan: ninguno significa "esta jugada no existió".
  // `payment_unknown` tampoco — quien decide descartarla es la persona, con el
  // hecho delante (`lib/pending-fate.ts`).
  "payment_pending",
  "payment_unknown",
  "chain_unavailable",
]);

/**
 * El único código que BORRA un envío de la bandeja: la cadena dice que esa
 * transacción revirtió. Revertir es que el estado volvió atrás — no se cobró la
 * entrada ni se gastó la jugada gratis— así que conservarla dejaría a alguien
 * sin jugar por una transacción que no le costó nada.
 */
const FINAL_ERRORS = new Set(["payment_reverted"]);

/**
 * Tope de UNA petición. Sin esto, `fetch` no vuelve nunca: en iOS basta con que
 * la webview se suspenda a mitad del envío para que la promesa quede colgada
 * para siempre, y con ella el botón en "Registrando jugada…". El spinner no
 * puede depender de que la red tenga la decencia de fallar.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export interface PostLimits {
  /** Tope de cada intento. */
  requestTimeoutMs?: number;
  /**
   * Tope de la secuencia entera, reintentos incluidos. Existe para el envío que
   * RETIENE al jugador: cinco intentos de 15 s son 75 s mirando un spinner, y
   * eso no es esperar, es estar colgado.
   */
  totalBudgetMs?: number;
}

/** El envío que retiene al jugador antes del 3, 2, 1: corto y con techo. */
export const BLOCKING_LIMITS: PostLimits = {
  requestTimeoutMs: 8_000,
  totalBudgetMs: 20_000,
};

/** El reenvío de fondo: sin prisa, pero nunca infinito. */
export const BACKGROUND_LIMITS: PostLimits = {
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
};

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

/** Un intento suelto, con tope de tiempo propio. */
async function postOnce(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<SendOutcome> {
  // `AbortController` a mano y no `AbortSignal.timeout`: el temporizador se
  // limpia pase lo que pase, y no hace falta que el navegador sea reciente.
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      return { result: "ok", data: data ?? undefined };
    }

    /**
     * El CÓDIGO manda sobre el status, y por eso se lee primero.
     *
     * Antes un 5xx se trataba como reintentable sin mirar el cuerpo, y eso
     * dejaba `chain_unavailable` (503) sin llegar nunca al cliente: el envío se
     * reintentaba igual, sí, pero la pantalla no podía decir por qué esperaba.
     */
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      payer?: string;
    } | null;

    if (data?.error && FINAL_ERRORS.has(data.error)) {
      return { result: "rejected", error: data.error, payer: data.payer };
    }
    if (data?.error && RETRYABLE_ERRORS.has(data.error)) {
      return { result: "retry", error: data.error, payer: data.payer };
    }
    // 5xx y 429 sin código propio: el servidor está mal o saturado.
    if (res.status >= 500 || res.status === 429) {
      return { result: "retry", error: data?.error };
    }

    return { result: "rejected", error: data?.error, payer: data?.payer };
  } catch {
    // Sin red, petición abortada, tiempo agotado, pestaña suspendida a mitad
    // del envío. Todo eso es "no sabemos": se conserva y se reintenta.
    return { result: "retry" };
  } finally {
    clearTimeout(reloj);
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
  delays: readonly number[],
  limits: PostLimits = BACKGROUND_LIMITS
): Promise<SendOutcome> {
  const timeout = limits.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const budget = limits.totalBudgetMs ?? Infinity;
  const empezo = Date.now();
  const queda = () => budget - (Date.now() - empezo);

  let last: SendOutcome = { result: "retry" };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      // Ni se espera ni se reintenta si al volver ya no quedaría presupuesto:
      // el jugador no gana nada mirando un spinner que va a fallar igual, y el
      // envío sigue guardado para el reenvío de fondo.
      const espera = delays[attempt - 1];
      if (queda() <= espera) break;
      await sleep(espera);
    }
    if (queda() <= 0) break;
    // El intento nunca puede durar más de lo que queda del presupuesto.
    last = await postOnce(url, body, Math.min(timeout, Math.max(queda(), 1)));
    if (last.result !== "retry") return last;
  }
  return last;
}
