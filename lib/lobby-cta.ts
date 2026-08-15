/**
 * Qué ofrece el botón del lobby, y por qué. Puro: sin React, sin red, sin
 * `window`.
 *
 * Vivía dentro de `HomeLobby` y era la ÚNICA decisión del camino de pago que no
 * se podía correr sin un navegador — justo la que decide si se puede pulsar
 * Jugar. `pay-guard.ts` protege el cobro, pero si el botón no llega a ofrecer
 * jugar, el guardián ni se entera. Sacarla aquí es lo que permite comparar el
 * estado ANTES de una partida, DESPUÉS de abandonarla y DESPUÉS de cerrar
 * sesión, que es como se encontró el fallo que documenta
 * `scripts/verify-lobby-cta.ts`.
 *
 * Devuelve CLAVES de mensaje, no frases: el idioma se resuelve al pintar.
 */

import type { MessageKey } from "./i18n";

/**
 * "start" arranca el flujo, "access" abre el modal contextual, "connect" abre
 * el conector, "retry" reintenta la wallet embebida, "resume" termina de
 * registrar una jugada ya pagada y "reload" vuelve a pedir el perfil.
 */
export type CtaAction =
  | "start"
  | "access"
  | "connect"
  | "retry"
  | "resume"
  | "reload";

export interface LobbyCta {
  support: MessageKey;
  label: MessageKey;
  disabled: boolean;
  action: CtaAction;
  /**
   * Por qué salió esto. No se pinta: existe para poder AFIRMAR en una prueba
   * cuál de las ramas se tomó, en vez de deducirlo del texto.
   */
  reason: string;
}

/** Estado de la wallet embebida (`lib/embedded-wallet.tsx`). */
export type EmbeddedStatus =
  | "idle"
  | "creating"
  | "connecting"
  | "ready"
  | "stuck"
  | "external";

export interface LobbyCtaInput {
  /** Hay una jugada pagada sin registrar, o un pagador por reconciliar. */
  blockedByPending: boolean;
  /** Ya sabemos si hay sesión, venga de donde venga. */
  profileReady: boolean;
  /** `privyAuth || walletSession`. */
  authenticated: boolean;
  /** El perfil se está trayendo. */
  profileLoading: boolean;
  /** El perfil no se pudo traer. NO es "no tiene alias". */
  profileFailed: boolean;
  /** Alias del perfil, o null. */
  profileAlias: string | null;
  /** wagmi tiene wallet activa. */
  walletConnected: boolean;
  /** wagmi sigue reenganchando. */
  walletReconnecting: boolean;
  embeddedStatus: EmbeddedStatus;
  inMiniPay: boolean;
  /** El conector de RainbowKit está disponible para abrirse. */
  canOpenConnectModal: boolean;
  /** Ya sabemos si esta wallet tiene alias propio. */
  walletAliasReady: boolean;
  walletAlias: string | null;
  /** La consulta de jugadas gratis ya respondió. */
  entitlementReady: boolean;
  /** Este mazo tiene la gratis del día disponible. */
  freeForDeck: boolean;
  /**
   * La dirección FIRMADA por el servidor en la sesión de wallet, si hay una.
   *
   * Cuando existe, el perfil deja de ser la única forma de saber quién es este
   * jugador: `/api/session/wallet` ya comprobó en la cadena que esa wallet
   * firmó una transacción nuestra. Por eso, con sesión de wallet, que
   * `/api/profile` tarde o falle deja de poder matar el botón.
   */
  walletSessionAddress?: string | null;
}

const checking = (reason: string): LobbyCta => ({
  support: "cta.checking.support",
  label: "cta.checking.label",
  disabled: true,
  action: "start",
  reason,
});

/** Gratis o pagada: lo decide el contrato, aquí solo se cuenta. */
function playCta(input: LobbyCtaInput, reason: string): LobbyCta {
  if (!input.entitlementReady) return checking(`${reason}/entitlement`);
  return input.freeForDeck
    ? {
        support: "cta.free.support",
        label: "cta.free.label",
        disabled: false,
        action: "start",
        reason: `${reason}/free`,
      }
    : {
        support: "cta.paid.support",
        label: "cta.paid.label",
        disabled: false,
        action: "start",
        reason: `${reason}/paid`,
      };
}

/** Hay sesión pero todavía no hay wallet con la que firmar. */
function walletCta(input: LobbyCtaInput): LobbyCta {
  if (input.embeddedStatus === "idle") {
    if (input.walletReconnecting) return checking("wallet/idle-reconnecting");
    return {
      support: "cta.login.support",
      label: "cta.login.label",
      disabled: false,
      action: "access",
      reason: "wallet/idle",
    };
  }
  if (input.embeddedStatus === "external") {
    return {
      support: "cta.wallet.external.support",
      label: "cta.wallet.external.label",
      disabled: !input.canOpenConnectModal,
      action: "connect",
      reason: "wallet/external",
    };
  }
  /**
   * `stuck` es la espera agotada. `ready` es una CONTRADICCIÓN: la wallet
   * embebida dice que hay conexión y el lobby dice que no.
   *
   * No debería ocurrir —los dos leen el mismo estado de wagmi— pero si ocurre,
   * el resto de esta función lo trataba como "preparando tu billetera" y dejaba
   * el botón apagado PARA SIEMPRE: el reloj de la paciencia
   * (`embedded-wallet.tsx`) solo corre mientras se está esperando algo, y aquí
   * nadie está esperando nada. Los dos casos comparten salida: un botón que
   * vuelve a intentarlo, que nunca cobra y siempre revalida.
   */
  if (input.embeddedStatus === "stuck" || input.embeddedStatus === "ready") {
    return {
      support: "cta.wallet.stuck.support",
      label: "cta.wallet.stuck.label",
      disabled: false,
      action: "retry",
      reason: `wallet/${input.embeddedStatus}`,
    };
  }
  return {
    support:
      input.embeddedStatus === "connecting"
        ? "cta.wallet.connecting.support"
        : "cta.wallet.creating.support",
    label: "cta.wallet.creating.label",
    disabled: true,
    action: "start",
    reason: `wallet/${input.embeddedStatus}`,
  };
}

export function decideLobbyCta(input: LobbyCtaInput): LobbyCta {
  /**
   * Candado contra el segundo cobro. Va PRIMERO: mientras haya una jugada
   * pagada sin registrar, el botón no puede ofrecer jugar.
   */
  if (input.blockedByPending) {
    return {
      support: "cta.resume.support",
      label: "cta.resume.label",
      disabled: false,
      action: "resume",
      reason: "pending",
    };
  }
  /**
   * ── La sesión de wallet como segunda fuente ────────────────────────────────
   *
   * Sin esto, la PRIMERA jugada rompía las siguientes. Cada jugada crea una
   * sesión de wallet (`pay.ts` → `ensureWalletSession`), eso pone
   * `authenticated` en true, y el botón pasaba de una rama que no consultaba
   * `/api/profile` a otra que dependía de él por completo: si el perfil tardaba,
   * fallaba o volvía sin alias, el botón moría y solo cerrar sesión lo
   * revivía — porque el logout borra justamente esa sesión.
   *
   * Con la sesión viva no hace falta el perfil para saber quién juega: el
   * servidor firmó esa dirección después de comprobar en la cadena que la
   * wallet firmó una transacción nuestra. Así que las tres esperas que
   * dependían del perfil dejan de bloquear, y el nombre sale del que la propia
   * wallet ya tiene (`/api/wallet-alias`).
   *
   * Ofrecer jugar NO es autorizar el cobro: `decidePlayStart` vuelve a correr
   * entero en cada toque y ahora exige esa MISMA dirección firmada, así que una
   * wallet distinta a la canónica sigue sin poder pagar.
   */
  const sesionDeWallet = Boolean(input.walletSessionAddress);

  if (!input.profileReady && !sesionDeWallet) return checking("profile/not-ready");
  if (input.authenticated && input.profileLoading && !sesionDeWallet)
    return checking("profile/loading");
  if (input.walletReconnecting) return checking("wallet/reconnecting");
  // El perfil no se pudo cargar. NO es un jugador sin alias.
  if (input.authenticated && input.profileFailed && !sesionDeWallet) {
    return {
      support: "cta.profile_failed.support",
      label: "cta.profile_failed.label",
      disabled: false,
      action: "reload",
      reason: "profile/failed",
    };
  }
  if (input.authenticated) {
    // El del perfil manda; el de la wallet lo respalda cuando el perfil no
    // pudo traerlo. Los dos nombran a la misma dirección.
    const alias = input.profileAlias ?? (sesionDeWallet ? input.walletAlias : null);
    if (!alias) {
      // Todavía se está preguntando por el nombre de la wallet: esperar es
      // correcto, pedir un nombre que quizá ya tiene no lo es.
      if (sesionDeWallet && !input.walletAliasReady)
        return checking("session/alias-loading");
      return {
        support: "cta.alias.support",
        label: "cta.alias.label",
        disabled: false,
        action: "access",
        reason: "session/needs-alias",
      };
    }
    if (!input.walletConnected) return walletCta(input);
    return playCta(input, "session");
  }
  if (input.walletConnected) {
    // Fuera de MiniPay una dirección conectada no es una cuenta: se pide firma.
    if (!input.inMiniPay) {
      return {
        support: "cta.sign.support",
        label: "cta.sign.label",
        disabled: false,
        action: "access",
        reason: "wallet-only/needs-signature",
      };
    }
    if (!input.walletAliasReady) return checking("wallet-only/alias-loading");
    if (!input.walletAlias) {
      return {
        support: "cta.alias.support",
        label: "cta.alias.label",
        disabled: false,
        action: "access",
        reason: "wallet-only/needs-alias",
      };
    }
    return playCta(input, "wallet-only");
  }
  return {
    support: "cta.login.support",
    label: "cta.login.label",
    disabled: false,
    action: "access",
    reason: "no-session",
  };
}
