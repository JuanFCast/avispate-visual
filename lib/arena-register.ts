/**
 * Lo que pasa DESPUÉS de pagar la entrada: registrar la silla y canjear su ficha.
 *
 * Sin React, sin `fetch` y sin wagmi: los efectos entran por parámetro. No es
 * ceremonia — este trozo decide qué hacer cuando algo falla con el dinero ya
 * fuera de la wallet, y eso hay que poder recorrerlo entero desde
 * `scripts/verify-arena-register.ts` sin montar una cadena ni un navegador.
 *
 * ── La regla que gobierna todo este archivo ────────────────────────────────
 *
 * **Desde que existe el hash de la transacción, ya no se puede fallar de una
 * forma que obligue a pagar otra vez.** El dinero salió; lo único que falta es
 * contarlo. Por eso aquí se reintenta con ganas, y por eso el único final malo
 * deja el pago marcado como pendiente para que el botón diga "Terminar de
 * registrar" y no "Pagar".
 *
 * ── El 401, que era el agujero ─────────────────────────────────────────────
 *
 * `/rooms/[code]/paid` pide sesión. Dentro de MiniPay el jugador nuevo no tiene
 * ninguna hasta que la abre con esta misma transacción, así que el primer
 * intento puede llegar sin ella. Antes eso se reintentaba cinco veces contra la
 * misma cabecera vacía —cinco 401 idénticos— y terminaba en una silla pagada e
 * imposible de registrar: el peor final que este camino puede tener.
 *
 * Ahora un 401 no es "espera y prueba otra vez", es "te falta la sesión": se va
 * a buscarla y se reintenta EN EL ACTO, sin gastar espera, porque lo que
 * cambió no fue el tiempo.
 */

/** Esperas entre intentos de registrar. Unos 30 s en total. */
export const PAID_BACKOFF_MS = [1500, 3000, 5000, 8000, 12000] as const;

/** Esperas entre intentos de canjear la ficha. La huella se lee de la cadena. */
export const SEAT_BACKOFF_MS = [1500, 3000, 5000] as const;

export interface RegisterSeatDeps {
  /** POST a `/rooms/[code]/paid`. Devuelve el código HTTP; nunca lanza. */
  postPaid: () => Promise<number>;
  /** POST a `/api/arena/seat`. Devuelve la ficha, o `null` si no la dio. */
  postSeat: () => Promise<string | null>;
  /**
   * Consigue sesión canjeando el hash de ESTA transacción. `true` si a partir
   * de ahora hay una. Es idempotente y barato: si ya había, contesta que sí sin
   * tocar la red.
   */
  recoverSession: () => Promise<boolean>;
  /** Esperar. Inyectada para que la prueba no tarde medio minuto. */
  wait: (ms: number) => Promise<void>;
  onStage?: (stage: "registering" | "claiming") => void;
}

export type RegisterSeatResult =
  | { ok: true; token: string }
  /** La silla está ocupada, o quien pagó no es quien dice. No se arregla solo. */
  | { ok: false; reason: "conflict" }
  /** Se agotaron los intentos de registrar. El pago sigue pendiente. */
  | { ok: false; reason: "not_registered" }
  /** Registrado, pero la ficha no llegó. La silla existe; falta el permiso. */
  | { ok: false; reason: "no_seat_token" };

const isOk = (status: number) => status >= 200 && status < 300;

export async function registerSeat(
  deps: RegisterSeatDeps
): Promise<RegisterSeatResult> {
  const { postPaid, postSeat, recoverSession, wait, onStage } = deps;

  onStage?.("registering");

  let waits = 0;
  /**
   * El reintento inmediato se da UNA vez.
   *
   * Sin este freno hay un bucle cerrado y muy fácil de provocar: si la sesión
   * recuperada no es la que `/paid` acepta —otra dirección, por ejemplo—, cada
   * 401 pediría sesión, `recoverSession` contestaría que sí (ya hay una) y se
   * reintentaría al instante para siempre. Después del primero, todo 401 pasa
   * por la espera como cualquier otro fallo.
   */
  let usedFreeRetry = false;

  for (;;) {
    const status = await postPaid();
    if (isOk(status)) break;

    // Un 409 no se arregla esperando: silla ocupada o pagador que no coincide.
    // Insistir solo retrasaría el aviso a quien tiene que resolverlo.
    if (status === 409) return { ok: false, reason: "conflict" };

    if (status === 401) {
      // Se pide sesión en CADA 401, no solo en el primero: el motivo más común
      // de que falle es que el nodo del servidor todavía no ve la transacción,
      // y eso se arregla con el siguiente intento, no con el mismo.
      const recovered = await recoverSession();
      if (recovered && !usedFreeRetry) {
        usedFreeRetry = true;
        continue;
      }
    }

    if (waits >= PAID_BACKOFF_MS.length) {
      return { ok: false, reason: "not_registered" };
    }
    await wait(PAID_BACKOFF_MS[waits++]);
  }

  // Canjear la ficha NO pide sesión —la silla es de una dirección que pagó, no
  // de una cuenta— así que aquí no hay 401 que recuperar. Lo único que puede
  // fallar es que el nodo aún no vea la huella, y eso se cura esperando.
  onStage?.("claiming");

  let seatWaits = 0;
  for (;;) {
    const token = await postSeat();
    if (token) return { ok: true, token };

    if (seatWaits >= SEAT_BACKOFF_MS.length) {
      return { ok: false, reason: "no_seat_token" };
    }
    await wait(SEAT_BACKOFF_MS[seatWaits++]);
  }
}
