/**
 * Qué significa un choque contra un índice único al registrar dinero.
 *
 * Función pura, para poder probar sin base de datos lo único que de verdad
 * importa aquí: distinguir **un reintento** de **otra cosa ocupando el sitio**.
 * Confundirlos tiene las dos formas de salir mal — tratar un reintento como
 * error deja a alguien pagado y sin silla; tratar una colisión real como
 * reintento le da la silla ajena.
 */

export type SeatWriteVerdict =
  /** El mismo pago otra vez: la red reintentando. Es éxito. */
  | { status: "duplicate" }
  /** Esa dirección ya tiene silla en esta sala con OTRO pago. */
  | { status: "conflict"; reason: "wallet_already_seated" }
  /** El asiento se lo llevó otro entre que se calculó y se escribió. */
  | { status: "conflict"; reason: "seat_taken" };

/**
 * @param existing la fila que ya ocupaba el sitio, si se pudo leer
 * @param txHash   el pago que se estaba intentando registrar
 */
export function classifySeatWrite(
  existing: { join_tx_hash?: string | null } | null,
  txHash: string
): SeatWriteVerdict {
  const mine = txHash.trim().toLowerCase();
  const theirs = (existing?.join_tx_hash ?? "").trim().toLowerCase();

  // Mismo hash: es literalmente el mismo pago. Nada que hacer y todo bien.
  if (existing && theirs && theirs === mine) return { status: "duplicate" };

  // Hay fila de esa dirección pero con otro pago: dos entradas de la misma
  // wallet en la misma sala. No se sienta dos veces; se avisa.
  if (existing) {
    return { status: "conflict", reason: "wallet_already_seated" };
  }

  // No hay fila de esa dirección, así que lo que chocó fue el asiento: otro
  // llegó primero. Se recalcula y se reintenta más arriba.
  return { status: "conflict", reason: "seat_taken" };
}
