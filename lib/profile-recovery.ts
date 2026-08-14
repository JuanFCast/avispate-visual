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
}

export function createSequenceGate(): SequenceGate {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (seq: number) => seq === current,
  };
}
