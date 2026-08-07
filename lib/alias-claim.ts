"use client";

import { validateAlias } from "./alias";

/**
 * ¿Se va a poder guardar el puntaje de esta jugada, ANTES de cobrarla?
 *
 * El cobro es una transacción on-chain y no se deshace, pero `/api/scores`
 * rechaza la partida de una wallet que no tiene alias si el que se le manda ya
 * es de otra. Hasta el 2026-08-07 eso se descubría al TERMINAR de jugar: se
 * cobraba la entrada y el puntaje se caía después. Le pasó a Juan con su propia
 * cuenta, pero la trampa es general — le espera a cualquier jugador nuevo cuyo
 * nombre favorito esté ocupado.
 *
 * Se comprueba contra la dirección ya CONFIRMADA con la wallet, no contra la
 * que wagmi tenía guardada ni contra la sesión abierta: el puntaje se guarda
 * contra quien firma, y confundirlas fue el error original.
 */

export type AliasVerdict =
  /** Se puede cobrar. */
  | { kind: "ok" }
  /** No hay nombre válido que mandar; sin uno el servidor rechaza la partida. */
  | { kind: "needs_name" }
  /**
   * El nombre ya está vinculado a OTRA dirección. Casi siempre es otra wallet
   * de la misma persona, así que viaja la dirección para poder mostrarla y que
   * la reconozca.
   */
  | { kind: "name_taken"; owner: string | null };

export async function checkAliasBeforePaying(
  alias: string,
  wallet: string
): Promise<AliasVerdict> {
  if (!wallet) return { kind: "ok" };

  try {
    // 1. Si la wallet YA tiene nombre, el servidor no va a pedir ninguno y el
    //    puntaje entra pase lo que pase con el nombre de la sesión.
    const res = await fetch(
      `/api/wallet-alias?address=${encodeURIComponent(wallet)}`
    );
    if (!res.ok) return { kind: "ok" };
    const owned = (await res.json()) as { alias?: string | null };
    if (owned?.alias) return { kind: "ok" };

    // 2. Wallet estrenando: el nombre que viajará con el puntaje tiene que
    //    servir. Sin uno válido, `/api/scores` responde `alias_required`.
    const check = validateAlias(alias);
    if (!check.ok || !check.value) return { kind: "needs_name" };

    const free = await fetch(
      `/api/alias-available?alias=${encodeURIComponent(check.value)}&wallet=${encodeURIComponent(wallet)}`
    );
    if (!free.ok) return { kind: "ok" };
    const data = (await free.json()) as {
      available?: boolean;
      owner?: string | null;
    };
    if (data?.available) return { kind: "ok" };
    return { kind: "name_taken", owner: data?.owner ?? null };
  } catch {
    // Fallo de red en la comprobación: NO se bloquea el juego por eso. Si el
    // puntaje acaba rechazándose, la bandeja de salida ya no lo tira (ver
    // `submit.ts`), así que se guarda solo en cuanto haya nombre.
    //
    // Ojo con la asimetría, que es deliberada: la wallet falla CERRADO (sin
    // confirmar la cuenta no se cobra) y esto falla ABIERTO. La diferencia es
    // qué se arriesga — allí, cobrarle a quien no debe; aquí, un puntaje que se
    // reintenta solo.
    return { kind: "ok" };
  }
}
