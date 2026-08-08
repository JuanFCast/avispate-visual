"use client";

/**
 * La ficha de silla en el dispositivo, y cómo viaja en cada petición.
 *
 * Se guarda aparte de la sesión y viaja en su propia cabecera. No es un detalle
 * de implementación: la sesión dice quién eres y la ficha dice qué silla
 * probaste, y mantenerlas separadas es lo que impide que un día alguien acepte
 * una donde va la otra.
 */

/**
 * Se guarda por CÓDIGO de sala, no por identificador de mesa.
 *
 * El secreto sí va por mesa —es lo que el contrato conoce—, pero la ficha la
 * usa el cliente en cada petición, y lo que el cliente siempre tiene a mano es
 * el código. Guardarla por mesa obligaría a arrastrar el identificador hasta la
 * pantalla de partida solo para poder buscarla.
 */
const KEY_PREFIX = "avispateSeatToken_v1:";

/** Cabecera propia. Nunca `Authorization`. */
export const SEAT_HEADER = "x-avispate-seat";

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberSeatToken(code: string, token: string): void {
  store()?.setItem(KEY_PREFIX + code.toUpperCase(), token);
}

export function seatTokenFor(code: string): string | null {
  return store()?.getItem(KEY_PREFIX + code.toUpperCase()) ?? null;
}

export function forgetSeatToken(code: string): void {
  store()?.removeItem(KEY_PREFIX + code.toUpperCase());
}

/**
 * Añade la ficha a unas cabeceras, si la hay.
 *
 * Sin ficha guardada no añade nada: en una sala gratis no hace falta, y en una
 * paga el servidor responderá `seat_token_required`, que es la respuesta
 * correcta y no algo que debamos disimular desde aquí.
 */
export function withSeatHeader(
  headers: HeadersInit,
  code: string | null | undefined
): HeadersInit {
  if (!code) return headers;
  const token = seatTokenFor(code);
  if (!token) return headers;
  return { ...headers, [SEAT_HEADER]: token };
}

/**
 * El pago de la silla, guardado en el dispositivo hasta que el servidor lo
 * acepta.
 *
 * Sin esto, una silla pagada cuyo registro falla deja al jugador delante de un
 * botón que dice "pagar" — y pagar otra vez es lo único que no debe hacer.
 * Guardando el hash se le puede ofrecer TERMINAR, que es lo que falta de
 * verdad. Se borra cuando el registro entra.
 */
const PAID_PREFIX = "avispateSeatPaid_v1:";

export interface PendingSeatPayment {
  txHash: string;
  address: string;
}

export function rememberSeatPayment(
  code: string,
  payment: PendingSeatPayment
): void {
  try {
    store()?.setItem(PAID_PREFIX + code.toUpperCase(), JSON.stringify(payment));
  } catch {
    // Sin sitio para guardarlo se pierde la vía de reintento, no el dinero:
    // el pago sigue en el contrato y la mesa acaba devolviéndolo.
  }
}

export function seatPaymentFor(code: string): PendingSeatPayment | null {
  try {
    const raw = store()?.getItem(PAID_PREFIX + code.toUpperCase());
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingSeatPayment;
    return p?.txHash && p?.address ? p : null;
  } catch {
    return null;
  }
}

export function forgetSeatPayment(code: string): void {
  store()?.removeItem(PAID_PREFIX + code.toUpperCase());
}
