"use client";

import { validateAlias } from "./alias";
import type { MessageKey } from "./i18n";

/**
 * ¿Se va a poder guardar el puntaje de esta jugada, ANTES de cobrarla?
 *
 * El cobro es una transacción on-chain y no se deshace, pero `/api/scores`
 * rechaza la partida de una wallet que no tiene alias si el que se le manda ya
 * es de otra. Hasta el 2026-08-07 eso se descubría al TERMINAR de jugar: se
 * cobraba la entrada y el puntaje se caía después. Le pasó a Juan con su propia
 * cuenta (ver el arreglo de identidad en `supabase/profiles.ts`), pero la
 * trampa es general — le espera a cualquier jugador nuevo cuyo nombre favorito
 * esté ocupado.
 *
 * Lo que se comprueba es la wallet que va a FIRMAR, no la sesión abierta: el
 * puntaje se guarda contra la primera, y confundirlas es justamente lo que dejó
 * pasar el caso de Juan (sesión con alias, wallet sin él).
 *
 * Devuelve el mensaje que hay que mostrar, o `null` si se puede cobrar.
 */
export async function aliasBlocker(
  alias: string,
  wallet: string | null | undefined
): Promise<MessageKey | null> {
  if (!wallet) return null;

  try {
    // 1. Si la wallet YA tiene alias, el servidor no va a pedir ninguno y el
    //    puntaje entra pase lo que pase con el nombre de la sesión.
    const res = await fetch(
      `/api/wallet-alias?address=${encodeURIComponent(wallet)}`
    );
    if (!res.ok) return null;
    const owned = (await res.json()) as { alias?: string | null };
    if (owned?.alias) return null;

    // 2. Wallet estrenando: el alias que viajará con el puntaje tiene que
    //    servir. Sin uno válido, `/api/scores` responde `alias_required`.
    const check = validateAlias(alias);
    if (!check.ok || !check.value) return "pay.error.alias_needed";

    const free = await fetch(
      `/api/alias-available?alias=${encodeURIComponent(check.value)}&wallet=${encodeURIComponent(wallet)}`
    );
    if (!free.ok) return null;
    const data = (await free.json()) as { available?: boolean };
    return data?.available ? null : "pay.error.alias_taken";
  } catch {
    // Fallo de red en la comprobación: NO se bloquea el juego por eso. Si el
    // puntaje acaba rechazándose, la bandeja de salida ya no lo tira (ver
    // `submit.ts`), así que se guarda solo en cuanto haya alias.
    return null;
  }
}
