/**
 * Las decisiones de seguridad del cobro, sin React y sin red.
 *
 * Todo lo que puede costarle dinero a un jugador se decide aquí, con funciones
 * que reciben hechos y devuelven una decisión. Nada de hooks, nada de `fetch`,
 * nada de `window`: así se puede correr entero desde `scripts/verify-pay-guard.ts`
 * y comprobar los casos que de otra forma haría falta reproducir a mano con una
 * extensión bloqueada, que es exactamente lo que nunca se prueba.
 *
 * La regla que implementa, en una línea: **la misma dirección tiene que ser la
 * wallet accesible, la que valida el alias, la que firma y la que aparece como
 * pagadora on-chain.** Si en cualquier punto deja de serlo, se para.
 */

/** Lo que se pudo averiguar preguntándole a la wallet por sus cuentas. */
export type WalletProbe =
  /** La wallet contestó. `accounts` puede venir vacío: eso es "bloqueada". */
  | { status: "answered"; accounts: readonly string[] }
  /**
   * No se pudo preguntar (el conector lanzó, no hay conector, el proveedor no
   * responde). NO se asume nada: no saber es motivo suficiente para parar.
   */
  | { status: "unreachable"; reason: string };

/** Una jugada ya pagada que todavía no consta en el servidor. */
export interface PendingPlay {
  txHash: string;
  /** Dirección que el navegador creía que estaba pagando. */
  player: string;
  deckSize: number;
}

export type PayDecision =
  /** Hay una jugada pagada sin registrar: NO se cobra otra, se termina esa. */
  | { kind: "resume_pending"; pending: PendingPlay }
  /** No se pudo confirmar la cuenta activa. Hay que reconectar. */
  | { kind: "reconnect"; reason: "locked" | "unreachable" }
  /** La wallet expone una cuenta distinta a la que la app tenía. */
  | { kind: "account_changed"; expected: string; actual: string }
  /** Vía libre, y esta es la dirección con la que hay que seguir TODO. */
  | { kind: "proceed"; address: string };

const norm = (a: string | null | undefined): string =>
  (a ?? "").trim().toLowerCase();

/**
 * ¿Se puede empezar una jugada nueva?
 *
 * El orden importa y no es negociable:
 *
 * 1. Jugada pendiente primero. Si ya existe un txHash sin registrar, el dinero
 *    ya salió: pedir otro pago sería cobrar dos veces por una partida. Esto va
 *    ANTES que cualquier comprobación de wallet, porque una wallet en mal
 *    estado no es razón para volver a cobrar.
 * 2. Wallet accesible. Falla CERRADO: si la wallet no contesta, no se cobra.
 *    Una extensión bloqueada devuelve lista vacía, pero no es la única forma —
 *    algunos proveedores lanzan error y otros ni responden. Los tres casos
 *    paran igual.
 * 3. Dirección confirmada. La cuenta que la wallet expone AHORA manda sobre la
 *    que la app tenía guardada. Si no coinciden, no se sigue con datos de la
 *    anterior: se revalida la identidad entera con la nueva.
 */
export function decidePlayStart(input: {
  /** Dirección que la app cree tener conectada (la de wagmi). */
  expected: string | null | undefined;
  probe: WalletProbe;
  pending: PendingPlay | null;
}): PayDecision {
  if (input.pending) return { kind: "resume_pending", pending: input.pending };

  if (input.probe.status === "unreachable") {
    return { kind: "reconnect", reason: "unreachable" };
  }

  const accounts = input.probe.accounts.map(norm).filter(Boolean);
  if (accounts.length === 0) return { kind: "reconnect", reason: "locked" };

  const expected = norm(input.expected);
  // Sin dirección previa (primera conexión) la que expone la wallet es la
  // buena; no hay nada anterior que invalidar.
  if (!expected) return { kind: "proceed", address: accounts[0] };

  // La cuenta esperada sigue expuesta aunque no sea la primera de la lista:
  // varias wallets devuelven todas las autorizadas y el orden no es promesa.
  if (accounts.includes(expected)) return { kind: "proceed", address: expected };

  return { kind: "account_changed", expected, actual: accounts[0] };
}

/**
 * Segunda comprobación, pegada a la firma.
 *
 * Entre validar la identidad y firmar pasan segundos y varias lecturas de la
 * cadena — tiempo de sobra para que alguien cambie de cuenta en la extensión.
 * Lo que se firma tiene que salir de la misma dirección que se validó, así que
 * se vuelve a preguntar justo antes y se corta si cambió.
 */
export function confirmBeforeSigning(
  validated: string,
  probe: WalletProbe
): { ok: true } | { ok: false; decision: PayDecision } {
  const decision = decidePlayStart({
    expected: validated,
    probe,
    pending: null,
  });
  if (decision.kind === "proceed" && decision.address === norm(validated)) {
    return { ok: true };
  }
  // `proceed` con OTRA dirección solo puede pasar si `validated` venía vacío,
  // que en este punto sería un error de programación: se trata como cambio.
  if (decision.kind === "proceed") {
    return {
      ok: false,
      decision: {
        kind: "account_changed",
        expected: norm(validated),
        actual: decision.address,
      },
    };
  }
  return { ok: false, decision };
}

/**
 * Qué hacer con una jugada ya minada cuando la cadena dice que pagó una
 * dirección distinta a la que el navegador creía.
 *
 * NUNCA se corrige en silencio. El pago es válido y es de quien la cadena diga,
 * así que no se pierde; pero atribuirle la partida a una identidad que no es la
 * suya sería inventarse un dueño. Se reconoce el pago, se para, y que la
 * persona reconcilie qué cuenta es la suya.
 */
export function reconcilePayer(input: {
  /** Dirección que el cliente afirmó. */
  claimed: string;
  /** Dirección que emitió el `Played` en el contrato. La verdad. */
  onchain: string;
}): { kind: "match"; payer: string } | { kind: "mismatch"; payer: string; claimed: string } {
  const payer = norm(input.onchain);
  const claimed = norm(input.claimed);
  if (payer && payer === claimed) return { kind: "match", payer };
  return { kind: "mismatch", payer, claimed };
}
