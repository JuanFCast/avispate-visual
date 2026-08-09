/**
 * Cuál es TU wallet, cuando hay más de una candidata.
 *
 * Función pura —sin React, sin red, sin `window`— por lo mismo que
 * `pay-guard.ts`: decide sobre dinero y tiene que poder correrse entera desde
 * `scripts/verify-wallet-identity.ts`, incluyendo casos que a mano exigirían
 * bloquear una extensión en el instante exacto.
 *
 * ── El incidente que la hizo falta (PipeRabby, 2026-08-07) ─────────────────
 *
 * Un jugador con su Rabby de siempre entró con la extensión bloqueada. Privy no
 * pudo leer su dirección, lo dio por "usuario sin wallets" y le creó una
 * embebida. A partir de ahí la aplicación tuvo DOS direcciones para la misma
 * persona, y las repartió entre pantallas: las estadísticas salían del perfil
 * del servidor —su Rabby, con sus 12 partidas y sus premios— mientras la tarjeta
 * de cartera y los saldos salían de lo que wagmi tuviera conectado, que era la
 * embebida vacía. Mismo perfil, saldo de otro.
 *
 * ── La regla ──────────────────────────────────────────────────────────────
 *
 * **Si el perfil ya tiene dirección, esa manda.** No es un dato de contacto: es
 * la que cobra los premios y la que ata el historial. Una embebida creada por
 * accidente no la sustituye, no se autoactiva y no gobierna ninguna pantalla.
 *
 * Y cuando la conectada no es la canónica no se cambia de identidad ni se deja
 * pasar una operación económica: se pide conectar la correcta. Cambiar de wallet
 * tiene que ser un acto deliberado del jugador, nunca el efecto secundario de
 * una extensión bloqueada.
 *
 * Falla CERRADO. Mientras no se sepa qué hay conectado, la respuesta es "no lo
 * sé", y "no lo sé" no autoriza nada.
 */

export type WalletIdentityVerdict =
  /** La conectada ES la canónica. Todo permitido. */
  | { kind: "ok"; address: string }
  /**
   * El perfil todavía no tiene dirección: este jugador es nuevo y la que trae
   * conectada será la suya en cuanto el servidor la anote. Se permite operar —
   * si no, nadie podría estrenar cuenta.
   */
  | { kind: "no_canonical"; address: string }
  /**
   * Hay canónica y no es la que está conectada (o no hay ninguna conectada).
   * Se mira, no se opera: hay que conectar la correcta.
   */
  | { kind: "connect_canonical"; canonical: string; connected: string | null }
  /** Todavía no se sabe. No autoriza nada. */
  | { kind: "unknown" };

const norm = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

export interface WalletIdentityCheck {
  /** `profiles.wallet_address`: la que cobra. `null` si el perfil no tiene. */
  canonical: string | null;
  /** Lo que wagmi tiene conectado AHORA. `null` si nada. */
  connected: string | null;
  /**
   * ¿Ya terminó de resolverse el estado de la wallet?
   *
   * Mientras Privy arranca o el conector se reengancha, `connected` es `null`
   * sin que eso signifique "no hay wallet". Tratar ese hueco como una respuesta
   * haría parpadear un aviso de "conecta tu cartera" a quien la tiene puesta.
   */
  ready: boolean;
}

export function decideWalletIdentity(
  check: WalletIdentityCheck
): WalletIdentityVerdict {
  // Falla cerrado: sin haber terminado de mirar, no hay veredicto.
  if (!check.ready) return { kind: "unknown" };

  const canonical = norm(check.canonical);
  const connected = norm(check.connected);

  if (!canonical) {
    // Sin canónica todavía. La conectada será la suya; si tampoco hay, no se
    // sabe nada de nadie.
    return connected
      ? { kind: "no_canonical", address: connected }
      : { kind: "unknown" };
  }

  if (connected && connected === canonical) {
    return { kind: "ok", address: canonical };
  }

  // Hay canónica y lo conectado no es eso — otra wallet, o ninguna. Las dos
  // salen por la misma puerta a propósito: en las dos la respuesta del jugador
  // es la misma, conectar la que manda, y distinguirlas solo serviría para
  // escribir dos mensajes que dicen lo mismo.
  return {
    kind: "connect_canonical",
    canonical,
    connected: connected || null,
  };
}

/** ¿Se puede firmar, pagar o cobrar con lo que hay ahora mismo? */
export function mayTransact(verdict: WalletIdentityVerdict): boolean {
  return verdict.kind === "ok" || verdict.kind === "no_canonical";
}

/**
 * Qué dirección debe mirar la pantalla: saldos, tarjeta de cartera, premios.
 *
 * SIEMPRE la canónica cuando existe, aunque no esté conectada. Enseñar el saldo
 * de la que está puesta cuando no es la tuya fue exactamente el bug: el perfil
 * decía una cosa y la cartera otra, y las dos parecían igual de oficiales.
 */
export function walletToShow(verdict: WalletIdentityVerdict): string | null {
  switch (verdict.kind) {
    case "ok":
    case "no_canonical":
      return verdict.address;
    case "connect_canonical":
      return verdict.canonical;
    case "unknown":
      return null;
  }
}
