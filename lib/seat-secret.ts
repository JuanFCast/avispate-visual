import { keccak256 } from "viem";

/**
 * El secreto de una silla de la Arena: cómo se prueba que la silla es tuya
 * cuando la wallet no puede firmar un mensaje.
 *
 * MiniPay no soporta `personal_sign`, así que ahí la única prueba de control
 * disponible es una transacción — y una transacción es pública en cuanto se
 * mina. Cualquier prueba que consista en mirar la cadena la puede repetir otro
 * que también mire, y eso es lo que hacía inseguro sentar a alguien en una
 * mesa con dinero desde una sesión canjeada por un txHash.
 *
 * La salida no necesita firma: el dispositivo sortea un secreto, guarda el
 * secreto, y en la transacción de pago manda solo su HUELLA. La huella queda
 * pública en la cadena; el secreto no sale de aquí y del hash no se deduce. Un
 * mirón ve la huella y no puede reclamar la silla.
 *
 * ── El orden importa más que el mecanismo ─────────────────────────────────
 *
 * El secreto se escribe ANTES de enviar la transacción, igual que el txHash en
 * la bandeja de salida y por la misma razón: si se enviara primero y se
 * guardara después, cerrar la pestaña en el instante equivocado dejaría una
 * silla pagada que su dueño ya no puede reclamar — dinero suyo, inaccesible.
 *
 * Por eso este módulo no expone "generar" y "guardar" por separado. La única
 * forma de obtener la huella es `prepareSeat`, que guarda primero y devuelve
 * después. No se puede llamar en el orden incorrecto porque el orden incorrecto
 * no está disponible.
 */

const KEY_PREFIX = "avispateSeat_v1:";

/** Lo mínimo que necesitamos de `localStorage`, para poder probarlo sin navegador. */
export interface SeatStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStore(): SeatStore | null {
  if (typeof window === "undefined") return null;
  try {
    // Tocarlo para descubrir ya si está bloqueado (modo privado, permisos).
    window.localStorage.getItem(KEY_PREFIX);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 32 bytes de azar del sistema. `Math.random` no vale para esto. */
function randomSecret(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  )}`;
}

/** La huella pública de un secreto: lo único que viaja a la cadena. */
export function commitmentFor(secret: string): `0x${string}` {
  return keccak256(secret as `0x${string}`);
}

export interface PreparedSeat {
  /** Se queda en el dispositivo. Nunca va en una transacción. */
  secret: `0x${string}`;
  /** Va dentro del `join`, a la vista de todos. */
  commitment: `0x${string}`;
}

/**
 * Prepara la silla: sortea el secreto, lo GUARDA, y solo entonces devuelve la
 * huella para poder pagar.
 *
 * Si ya había un secreto para esta mesa se reutiliza — reintentar un pago que
 * falló no puede cambiar la huella, porque la que vale es la que quedó (o va a
 * quedar) en la cadena.
 *
 * Lanza si no se pudo guardar. Es deliberado y es la parte importante: pagar
 * sin haber guardado crearía una silla que su dueño no puede reclamar, y es
 * mejor no dejar jugar que cobrar una entrada inaccesible.
 */
export function prepareSeat(
  tableId: string,
  store: SeatStore | null = browserStore()
): PreparedSeat {
  if (!store) throw new Error("seat_store_unavailable");

  const key = KEY_PREFIX + tableId.toLowerCase();
  const existing = store.getItem(key);
  if (existing) {
    return { secret: existing as `0x${string}`, commitment: commitmentFor(existing) };
  }

  const secret = randomSecret();
  store.setItem(key, secret);

  // Releer no es paranoia barata: `setItem` puede fallar en silencio con la
  // cuota llena, y descubrirlo aquí cuesta nada mientras que descubrirlo
  // después cuesta la entrada de alguien.
  if (store.getItem(key) !== secret) throw new Error("seat_store_unavailable");

  return { secret, commitment: commitmentFor(secret) };
}

/** El secreto guardado de una mesa, si lo hay. */
export function seatSecretFor(
  tableId: string,
  store: SeatStore | null = browserStore()
): string | null {
  if (!store) return null;
  return store.getItem(KEY_PREFIX + tableId.toLowerCase());
}

/**
 * Olvida el secreto de una mesa. Solo cuando ya no hay silla que reclamar: la
 * mesa se liquidó o se devolvió la entrada. Borrarlo antes deja al jugador sin
 * poder probar que la silla es suya.
 */
export function forgetSeatSecret(
  tableId: string,
  store: SeatStore | null = browserStore()
): void {
  if (!store) return;
  store.removeItem(KEY_PREFIX + tableId.toLowerCase());
}
