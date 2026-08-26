/**
 * Qué hacer con una jugada que quedó sin registrar.
 *
 * Hasta ahora había una sola respuesta para todo —"reintenta"— y eso convertía
 * un hash que la red nunca vio en una trampa de 48 horas: la bandeja lo
 * reintentaba, el servidor contestaba `invalid_payment`, y el botón volvía a
 * decir "Registrando jugada…" para siempre. La salida tampoco puede ser la
 * contraria: descartar en cuanto un nodo no encuentre algo es cómo se pierde
 * una jugada que sí se pagó.
 *
 * Así que se distingue, y cada caso tiene UNA respuesta:
 *
 * | veredicto     | qué pasó de verdad                  | qué se hace              |
 * |---------------|-------------------------------------|--------------------------|
 * | `ok`          | el servidor la registró             | se borra, se juega       |
 * | `reverted`    | se minó y revirtió: no cobró nada   | se borra, se puede jugar |
 * | `pending`     | está en vuelo, la red la conoce     | se espera, NO se cobra   |
 * | `unknown`     | varios nodos: ese hash no existe    | se ofrece descartarla    |
 * | `invalid`     | minada y sin nuestro evento         | se conserva, se reintenta|
 * | `unavailable` | no se pudo preguntar a la cadena    | se conserva, se reintenta|
 * | `server_error`| se cayó el servidor                 | se conserva, se reintenta|
 *
 * Las dos únicas filas que sueltan el candado son `reverted` —donde la cadena
 * misma dice que no se cobró— y `ok`. `unknown` NO lo suelta sola: propone, y
 * decide la persona. Esa es la diferencia entre darle una salida y quitarle la
 * jugada.
 *
 * Puro: sin React, sin red, sin `window` (ver `scripts/verify-pending-fate.ts`).
 */

/** Lo que dijo el servidor sobre el pago, ya traducido de códigos a hechos. */
export type PlayVerdict =
  /** Registrada. */
  | "ok"
  /** Minada y revertida: el contrato no cobró la entrada ni gastó la gratis. */
  | "reverted"
  /** La red la conoce pero todavía no la mina. */
  | "pending"
  /** Con consenso de varios nodos: ese hash no existe en la red. */
  | "unknown"
  /** Minada y correcta, pero sin un `Played` nuestro que corresponda. */
  | "invalid"
  /** No se pudo preguntar a la cadena. */
  | "unavailable"
  /** El servidor falló por su cuenta. */
  | "server_error";

export type PendingAction =
  /** Se borra de la bandeja y la partida arranca. */
  | "start"
  /** Se borra: la cadena confirma que no hubo cobro. Se puede volver a jugar. */
  | "drop_and_allow"
  /** Se conserva y se espera, sin spinner y sin permitir otro cobro. */
  | "keep_waiting"
  /** Se conserva, pero se le ofrece a la persona descartarla y volver a jugar. */
  | "offer_discard"
  /** Se conserva y se reintenta más tarde. */
  | "keep_retrying";

export interface PendingFate {
  action: PendingAction;
  /** Si el candado del segundo cobro se puede levantar. */
  releasesLock: boolean;
  /** Por qué salió esto. No se pinta: sirve para afirmarlo en una prueba. */
  reason: string;
}

/**
 * Cuánto se espera antes de ofrecer descartar un hash que nadie encuentra.
 *
 * Una transacción recién firmada tarda en propagarse, y dentro de una webview
 * suspendida puede tardar más. Ofrecer descartarla a los diez segundos sería
 * invitar a tirar una jugada que estaba a punto de aparecer. Tres minutos es
 * mucho más que cualquier propagación real en Celo (~1 s por bloque) y sigue
 * siendo una espera que una persona aguanta.
 */
export const UNKNOWN_GRACE_MS = 3 * 60 * 1000;

/**
 * La decisión. `ageMs` es la edad del envío en la bandeja, no la de la
 * transacción: es lo único que el dispositivo sabe de verdad.
 */
export function decidePendingFate(input: {
  verdict: PlayVerdict;
  ageMs: number;
  graceMs?: number;
}): PendingFate {
  const grace = input.graceMs ?? UNKNOWN_GRACE_MS;
  switch (input.verdict) {
    case "ok":
      return { action: "start", releasesLock: true, reason: "registrada" };

    /**
     * La cadena dice que esa transacción revirtió. Revertir es que el estado
     * volvió atrás: no se cobró la entrada y no se gastó la jugada gratis (el
     * `Played` ni siquiera se emitió). Conservarla sería dejar a alguien sin
     * jugar por una transacción que no le costó nada más que el gas.
     */
    case "reverted":
      return {
        action: "drop_and_allow",
        releasesLock: true,
        reason: "revertida/sin-cobro",
      };

    /**
     * En vuelo. Se espera, y se espera SIN candado suelto: la transacción
     * existe, así que un segundo pago sería un segundo cobro de verdad.
     */
    case "pending":
      return {
        action: "keep_waiting",
        releasesLock: false,
        reason: "en-vuelo",
      };

    /**
     * Nadie la encuentra. Esto es lo más cerca que se puede estar de "esa
     * transacción no existió", pero no se actúa solo: primero se le da tiempo a
     * propagarse y después se le ofrece la salida a la persona, con el hecho
     * delante. La app no descarta jugadas por su cuenta.
     */
    case "unknown":
      return input.ageMs >= grace
        ? {
            action: "offer_discard",
            releasesLock: false,
            reason: "inexistente/con-gracia-cumplida",
          }
        : {
            action: "keep_waiting",
            releasesLock: false,
            reason: "inexistente/aún-en-gracia",
          };

    /**
     * Minada, correcta, y sin un `Played` que le corresponda. Es la más
     * incómoda: puede ser un mazo que no coincide, y ahí la jugada SÍ se cobró.
     * Se conserva. Que no se pueda registrar sola no autoriza a tirarla.
     */
    case "invalid":
      return {
        action: "keep_retrying",
        releasesLock: false,
        reason: "minada/sin-evento",
      };

    case "unavailable":
      return {
        action: "keep_retrying",
        releasesLock: false,
        reason: "cadena-incomunicada",
      };

    case "server_error":
      return {
        action: "keep_retrying",
        releasesLock: false,
        reason: "servidor",
      };
  }
}

/** Códigos que devuelve `/api/plays`, traducidos al veredicto que significan. */
export const VERDICT_BY_ERROR: Record<string, PlayVerdict> = {
  payment_reverted: "reverted",
  payment_pending: "pending",
  payment_unknown: "unknown",
  invalid_payment: "invalid",
  chain_unavailable: "unavailable",
  server_error: "server_error",
};

/**
 * Un código desconocido NO se interpreta: se trata como un fallo del servidor,
 * que es la lectura que conserva el pendiente. Una versión vieja de la app
 * hablando con un servidor nuevo no puede terminar tirando jugadas.
 */
export function verdictFromError(error: string | undefined): PlayVerdict {
  if (!error) return "server_error";
  return VERDICT_BY_ERROR[error] ?? "server_error";
}
