/**
 * Cerrar sesión de verdad: que el navegador deje de ser nadie.
 *
 * ── Qué es y qué NO es ────────────────────────────────────────────────────
 *
 * NO es cambiar la wallet de un perfil. Esa regla no se toca y sigue siendo
 * estricta: un perfil, una wallet, y `0x46d5…8c18` nunca se convierte en otra
 * cosa (ver `wallet-identity.ts`). Estando dentro de PipeRabby, conectar otra
 * wallet se bloquea, y así se queda.
 *
 * Es lo otro: al pulsar "Cerrar sesión", la identidad anterior deja de existir
 * EN ESTE NAVEGADOR. Después, conectar `0xBBBB` te mete en el perfil de
 * `0xBBBB` —el suyo, o uno nuevo si no tiene—, nunca en el de PipeRabby.
 *
 * Lo que nunca puede pasar, y es lo que esto evita:
 *
 *     PipeRabby → 0x46d5 · cerrar sesión · conectar 0xBBBB · PipeRabby → 0xBBBB
 *
 * ── Por qué hacía falta ───────────────────────────────────────────────────
 *
 * Porque el logout dejaba viva media identidad. `clearWalletSession` existía y
 * no se llamaba desde ningún sitio, así que la sesión sin firma sobrevivía en
 * `localStorage` y `ProfileProvider` seguía diciendo `authenticated` después de
 * que Privy cerrara la suya. Y wagmi guarda su conexión y vuelve a engancharla
 * al montar, así que la wallet anterior se reconectaba sola.
 *
 * ── La línea que no se cruza ──────────────────────────────────────────────
 *
 * Se borra IDENTIDAD y CONEXIÓN. No se borra DINERO.
 *
 * El secreto de una silla es la única forma de reclamar una entrada ya pagada;
 * un pago sin registrar es una partida cobrada que falta por contar; la bandeja
 * lleva jugadas pagadas pendientes de enviar. Ninguna de las tres pertenece a
 * la sesión: pertenecen a una transacción que ya ocurrió en la cadena y se
 * atribuyen por quién pagó, no por quién esté conectado. Borrarlas al cerrar
 * sesión sería quemarle dinero a alguien por pulsar un botón que dice otra cosa.
 *
 * La ficha de silla sí se borra, y es la excepción que confirma la regla: es un
 * PERMISO, no una prueba de pago —si otro entra en este mismo navegador, no
 * puede quedarse con la silla del anterior— y su dueño la recupera cuando
 * quiera enseñando el secreto, que no se toca.
 */

/** Estado de identidad y de conexión. Se va al cerrar sesión. */
export const IDENTITY_PREFIXES = [
  /** Sesión sin firma (MiniPay). La que mantenía viva la identidad. */
  "avispate.wallet-session",
  /** Permiso para actuar sobre una silla. Recuperable con el secreto. */
  "avispateSeatToken_v1:",
  /** Conexión recordada de wagmi: `wagmi.store`, `wagmi.recentConnectorId`… */
  "wagmi",
  /** WalletConnect v2 y su elección de deeplink. */
  "wc@2:",
  "WALLETCONNECT_",
  /** Reown / Web3Modal / AppKit. */
  "@w3m/",
  "@appkit/",
  "reown",
  /** Restos de Privy, por si el `logout()` del SDK deja algo. */
  "privy:",
] as const;

/**
 * DINERO. No se borra jamás al cerrar sesión.
 *
 * Va explícito y no implícito —"lo que no esté en la otra lista"— porque el
 * error que importa aquí es de un solo sentido: dejar una clave de más solo
 * ensucia, y borrar una de estas le cuesta una entrada a alguien.
 */
export const MONEY_PREFIXES = [
  /** Secreto de la silla: sin él, una entrada pagada no se puede reclamar. */
  "avispateSeat_v1:",
  /** Pago hecho y todavía sin registrar. */
  "avispateSeatPaid_v1:",
  /** Jugadas pagadas pendientes de enviar. */
  "avispateOutbox_v1",
] as const;

const startsWithAny = (key: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => key.startsWith(p));

/**
 * De todas las claves guardadas, cuáles hay que borrar al cerrar sesión.
 *
 * Pura y probada aparte: decide sobre datos que pueden valer dinero, así que no
 * puede depender de un navegador para saber si está bien.
 *
 * El dinero gana SIEMPRE. Si una clave cayera en las dos listas —hoy no pasa,
 * mañana quién sabe— se queda. Un empate se resuelve a favor de no borrar.
 */
export function keysToClearOnLogout(all: readonly string[]): string[] {
  return all.filter(
    (key) =>
      startsWithAny(key, IDENTITY_PREFIXES) && !startsWithAny(key, MONEY_PREFIXES)
  );
}

export interface LogoutDeps {
  /** `logout()` de Privy. Puede fallar; no puede impedir el resto. */
  privyLogout: () => Promise<void>;
  /** `disconnect()` de wagmi. */
  disconnect: () => void;
  /** Las claves guardadas ahora mismo. */
  storageKeys: () => string[];
  /** Borra una clave. */
  removeKey: (key: string) => void;
  /** Recarga entera, a la raíz. Es lo último que ocurre. */
  reload: () => void;
}

/**
 * Cierra la sesión y deja el navegador como recién llegado.
 *
 * El orden importa y la recarga va al final, no por elegancia: es lo que
 * garantiza que ningún proveedor —Privy, wagmi, RainbowKit— siga vivo con su
 * estado en memoria después de que el guardado ya no exista. Sin ella, el árbol
 * de React sobrevive al borrado y puede volver a escribir lo que se acaba de
 * limpiar, o quedarse esperando algo que ya no está.
 *
 * Ningún paso puede impedir los siguientes. Si Privy falla al cerrar, se sigue
 * limpiando y recargando igual: un logout a medias es peor que ninguno, porque
 * deja al jugador creyendo que salió.
 */
export async function logoutEverything(deps: LogoutDeps): Promise<void> {
  try {
    deps.disconnect();
  } catch {
    // Da igual: el borrado de abajo le quita a wagmi de dónde reconectar.
  }

  try {
    await deps.privyLogout();
  } catch {
    // Ídem. La recarga y el borrado hacen el resto.
  }

  try {
    for (const key of keysToClearOnLogout(deps.storageKeys())) {
      deps.removeKey(key);
    }
  } catch {
    // `localStorage` bloqueado (modo privado). La recarga sigue valiendo.
  }

  deps.reload();
}
