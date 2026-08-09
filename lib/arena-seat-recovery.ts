/**
 * Qué hacer cuando el servidor dice que falta la ficha de silla, a mitad de
 * partida.
 *
 * Los efectos se inyectan y la política es pura, igual que en
 * `arena-register.ts` y por el mismo motivo: esto decide sobre una mesa con
 * dinero y tiene que poder correrse entero desde
 * `scripts/verify-arena-seat-recovery.ts`, sin navegador y sin cadena.
 *
 * ── El caso, que cuesta el pozo ────────────────────────────────────────────
 *
 * La ficha dura dos horas desde el pago. Si alguien paga al poco de crearse la
 * sala y la mesa tarda casi dos horas en llenarse, la partida empieza con la
 * ficha a punto de vencer. Al vencer, `guardRoomSeat` rechaza cada movimiento
 * con `seat_token_required` — y quien no puede mover pierde por abandono, o sea
 * entrega el pozo. La pantalla de la sala ya sabía rescatar una ficha perdida;
 * la de la partida, que es donde se juega el dinero, no.
 *
 * No hace falta volver a pagar ni firmar nada: el secreto sigue en el
 * dispositivo desde antes del pago, y `/api/arena/seat` cambia el secreto por
 * una ficha nueva las veces que haga falta. Lo único que faltaba era pedirlo.
 *
 * ── Una sola vez ──────────────────────────────────────────────────────────
 *
 * El reintento es UNO y no un bucle, y esa es la parte que hay que respetar.
 * Si la ficha nueva tampoco sirve —la mesa se anuló, la dirección activa es
 * otra, el reloj del servidor va adelantado— reintentar otra vez daría el mismo
 * rechazo, y hacerlo dentro del bucle de juego significa martillear
 * `/api/arena/seat` con el teléfono en la mano de alguien que está perdiendo
 * una partida. Se intenta una vez, se devuelve lo que salga, y la pantalla
 * enseña el error de verdad en lugar de esconderlo tras un giro infinito.
 */

/** Los rechazos que se curan con una ficha nueva. Ningún otro. */
const RECOVERABLE = new Set(["seat_token_required", "seat_token_wrong_table"]);

/**
 * ¿Este rechazo se arregla pidiendo otra ficha?
 *
 * `seat_not_paid` NO está: significa que la cadena no reconoce a esa dirección
 * como pagadora de la mesa, y una ficha nueva no cambiaría eso — la emitiría
 * igual y volvería a rechazarse en la misma puerta. Pedirla sería gastar una
 * petición para llegar al mismo sitio.
 */
export function isSeatTokenProblem(status: number, error?: string): boolean {
  return status === 403 && Boolean(error) && RECOVERABLE.has(error as string);
}

export interface SeatRecoveryDeps<T> {
  /**
   * La petición original, tal cual. Se llama con la ficha que haya guardada en
   * ese momento, así que el reintento recoge sola la nueva.
   */
  send: () => Promise<{ status: number; error?: string; value: T }>;
  /** Canjea el secreto por una ficha nueva. `null` si no se pudo. */
  claim: () => Promise<string | null>;
  /** Guarda la ficha para que la siguiente petición la lleve. */
  remember: (token: string) => void;
}

export interface SeatRecoveryResult<T> {
  status: number;
  error?: string;
  value: T;
  /** Si hubo que rescatar la ficha. Solo para poder contarlo en las pruebas. */
  recovered: boolean;
}

/**
 * Manda la petición y, si el único problema era la ficha, la renueva y la manda
 * otra vez. Una sola vez.
 */
export async function withSeatRecovery<T>(
  deps: SeatRecoveryDeps<T>
): Promise<SeatRecoveryResult<T>> {
  const first = await deps.send();
  if (!isSeatTokenProblem(first.status, first.error)) {
    return { ...first, recovered: false };
  }

  const token = await deps.claim();
  // Sin ficha nueva no hay nada que reintentar: se devuelve el rechazo
  // original, que es la verdad de lo que pasó.
  if (!token) return { ...first, recovered: false };

  deps.remember(token);
  return { ...(await deps.send()), recovered: true };
}
