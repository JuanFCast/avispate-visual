/**
 * Las decisiones de `ProfileProvider.refresh()`, sin React y sin red.
 *
 * El bug era "estamos comprobando tu cuenta" para siempre: un `fetch` a
 * `/api/profile` sin tope de tiempo dejaba `loading` pegado en `true`, y
 * `canonicalFromProfile` (`lib/wallet-identity.ts`) reporta `loading` Y
 * `failed` como el mismo estado "cargando" — así que sin un tope, no había
 * forma de que la cuenta terminara de "resolverse", ni siquiera fallando.
 * Solo cerrar sesión y volver a entrar forzaba un `refresh()` nuevo.
 *
 * Esto separa esa lógica en funciones puras, igual que `pay-guard.ts`, para
 * que `scripts/verify-profile-recovery.ts` pueda correr los casos sin
 * levantar un navegador.
 */

/** Igual que el timeout de arranque de Privy (`SETTLE_LIMIT_MS`, 6s) pero al
    doble: esto es una ida y vuelta de red real contra nuestro propio
    servidor, no solo esperar a que un SDK local termine de hidratar. */
export const PROFILE_REQUEST_TIMEOUT_MS = 12_000;

/**
 * Lo que se espera por el TOKEN, que es una espera distinta de la del perfil.
 *
 * `getAccessToken()` de Privy es una llamada a un SDK que habla con su iframe;
 * puede tardar, fallar o no volver nunca. Es más corto que el del perfil
 * porque no es una ida y vuelta a nuestro servidor: si en ocho segundos el
 * SDK no ha contestado, no va a contestar.
 */
export const TOKEN_REQUEST_TIMEOUT_MS = 8_000;

export type BoundedCall<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown };

/**
 * Corre una promesa con tope de tiempo. SIEMPRE resuelve.
 *
 * Existe por el agujero que quedó abierto: `fetchProfileWithTimeout` acotaba
 * la petición del perfil, pero el `await getToken()` de justo antes no tenía
 * tope ninguno. Un SDK colgado ahí dejaba el perfil en "cargando" para
 * siempre, y `canonicalFromProfile` reporta "cargando" como "no lo sé", que
 * no autoriza nada — así que el jugador se quedaba con "Comprobando tu
 * perfil…" y un botón muerto, sin forma de salir salvo recargar.
 *
 * No cancela el trabajo de fondo (una promesa no se puede abortar desde
 * fuera): lo que hace es dejar de ESPERARLO, que es lo que hacía falta para
 * poder contarle algo al jugador.
 */
export async function callWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number
): Promise<BoundedCall<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<BoundedCall<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      run().then((value): BoundedCall<T> => ({ kind: "ok", value })),
      expiry,
    ]);
  } catch (error) {
    // Que el SDK lance NO es lo mismo que quedarse mudo, y se distinguen
    // aquí aunque quien llama trate a los dos igual: el día que uno de los
    // dos merezca otra respuesta, el dato ya está.
    return { kind: "error", error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cuánto puede durar un "comprobando tu perfil" antes de rendirse, pase lo
 * que pase.
 *
 * El último seguro, y existe porque este mismo cuelgue ya volvió tres veces
 * por caminos distintos: primero el `fetch` sin tope, luego el `getToken()`
 * sin tope, luego un `publish` que dejaba `fetched: false` con sesión viva.
 * Cada arreglo cerró SU puerta y la pantalla se quedó igual de muerta por la
 * siguiente.
 *
 * Así que esto no arregla ninguna causa: garantiza el SÍNTOMA. Pasado el
 * plazo, el perfil pasa a `failed` —que el lobby sabe ofrecer con un botón de
 * reintentar— en vez de seguir cargando. Cualquier causa futura que no se nos
 * haya ocurrido termina en un botón, no en un jugador mirando "Preparando…".
 *
 * Va por encima de los dos topes que puede acumular un intento legítimo
 * (token + perfil), para no cortar una carga lenta pero viva.
 */
export const PROFILE_SETTLE_LIMIT_MS = 22_000;

export type ProfileFetchOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "timeout" }
  | { kind: "network_error"; error: unknown };

/**
 * Corre `run` con un `AbortSignal` que se dispara solo a los `timeoutMs`.
 * SIEMPRE resuelve —nunca se queda colgada— porque es justo eso lo que
 * faltaba: antes nada garantizaba que la promesa del `fetch` terminara.
 */
export async function fetchProfileWithTimeout(
  run: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number = PROFILE_REQUEST_TIMEOUT_MS
): Promise<ProfileFetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await run(controller.signal);
    return { kind: "ok", response };
  } catch (error) {
    // El `abort()` del timeout hace que `run` rechace — se distingue de un
    // fallo de red real solo por si la señal ya estaba disparada.
    if (controller.signal.aborted) return { kind: "timeout" };
    return { kind: "network_error", error };
  } finally {
    clearTimeout(timer);
  }
}

export type ProfileRefreshAction =
  /** El perfil llegó bien: se publica. */
  | { kind: "success" }
  /**
   * La sesión de wallet (sin firma) que se usó para pedir el perfil ya no
   * vale para el servidor. Se borra —para que la PRÓXIMA jugada emita una
   * nueva— y el perfil publicado es "sin sesión", no "falló".
   */
  | { kind: "clear_invalid_session" }
  /** No se pudo saber nada del perfil, por lo que sea. Recuperable con un
      `refresh()` posterior — no es un estado final. */
  | { kind: "failed" };

/**
 * Qué hacer con el resultado de pedir `/api/profile`.
 *
 * La regla que importa: un 401 SOLO se interpreta como sesión de wallet
 * inválida si la petición se hizo CON una sesión de wallet. Un timeout, un
 * error de red o un 401/403/500 con un token de Privy nunca borran nada —
 * timeout y error de red ni siquiera llegan a mirar el código de estado.
 */
export function decideProfileRefreshAction(
  outcome: ProfileFetchOutcome,
  context: { usingWalletSession: boolean }
): ProfileRefreshAction {
  if (outcome.kind !== "ok") return { kind: "failed" };
  if (outcome.response.status === 401 && context.usingWalletSession) {
    return { kind: "clear_invalid_session" };
  }
  if (!outcome.response.ok) return { kind: "failed" };
  return { kind: "success" };
}

/**
 * Solo la consulta más reciente puede publicar su resultado.
 *
 * Sin esto, dos `refresh()` solapados (uno disparado por el montaje, otro por
 * un reintento manual) podían resolver en cualquier orden y el más viejo
 * pisar al más nuevo con datos atrasados.
 */
export interface SequenceGate {
  /** Marca el arranque de una consulta nueva y devuelve su número. */
  begin(): number;
  /** ¿Esta consulta sigue siendo la última que arrancó? */
  isCurrent(seq: number): boolean;
  /** El número actual. Solo lectura, para el panel de diagnóstico. */
  current(): number;
}

/**
 * Una consulta a la vez, y las que lleguen mientras tanto se COALESCEN.
 *
 * ── El caso real que lo hizo falta (2026-08-14, panel `?debugProfile=1`) ───
 *
 * `refresh()` se dispara desde cuatro sitios (el efecto de montaje por sus
 * tres entradas, y el `await refresh()` de `wallet-auth.ts` al terminar de
 * firmar). Cuando se solapan, cada uno pide número nuevo al `sequenceGate` y
 * la respuesta BUENA que venía en camino se descarta por "ya no eres la
 * actual". El panel lo cazó con todas las letras: `/api/profile` 200, y aun
 * así `ultimo publish = OK DESCARTADO` con el perfil en
 * `{fetched:false, failed:false}` — o sea cargando para siempre.
 *
 * La respuesta NO es quitar el gate: el gate está bien y protege del caso
 * legítimo (una consulta vieja no debe pisar a una nueva). Lo que está mal es
 * lanzar consultas redundantes que compiten entre sí. Con esto, mientras haya
 * una viva no se arranca otra; solo se anota que hay que repetir al terminar,
 * y se repite UNA vez pase lo que pase. Así el gate deja de tener a quién
 * descartar.
 */
export interface SingleFlight {
  /** Corre `job`, o se engancha al que ya está vivo y pide repetición. */
  run(job: () => Promise<void>): Promise<void>;
  /** ¿Hay una consulta viva ahora mismo? */
  busy(): boolean;
}

export function createSingleFlight(): SingleFlight {
  let live: Promise<void> | null = null;
  let again = false;

  const run = async (job: () => Promise<void>): Promise<void> => {
    if (live) {
      // Ya hay una en vuelo. Arrancar otra invalidaría su respuesta, así que
      // se espera a esa y se pide UNA repetición al final — que es lo que de
      // verdad quería quien llamó: datos frescos, no una carrera.
      again = true;
      await live;
      return;
    }
    live = (async () => {
      try {
        await job();
      } finally {
        live = null;
      }
    })();
    await live;
    if (again) {
      again = false;
      await run(job);
    }
  };

  return { run, busy: () => live !== null };
}

export function createSequenceGate(): SequenceGate {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (seq: number) => seq === current,
    current: () => current,
  };
}
