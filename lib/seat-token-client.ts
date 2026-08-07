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
