import type { AppIdentity } from "./identity";

/**
 * Quién puede crear una sala de la Arena.
 *
 * Función pura, por lo mismo que el resto de las decisiones que rozan dinero:
 * se prueba entera sin base ni red desde `scripts/verify-arena-create.ts`.
 *
 * ── Por qué crear NO exige sesión ─────────────────────────────────────────
 *
 * Dentro de MiniPay no se puede firmar un mensaje, así que la sesión se abre
 * canjeando una transacción de esa wallet. Y eso creaba un absurdo circular:
 * para pagar hacía falta una sala, para crear la sala hacía falta sesión, y la
 * sesión salía de pagar. La única salida era jugar una partida individual del
 * reto antes de poder montar una mesa — que es lo que Juan encontró probando.
 *
 * La salida buena es mirar qué otorga crear una sala, y la respuesta es NADA:
 *
 *   · no sienta a nadie (con escrow, la silla la crea el pago on-chain),
 *   · no permite jugar, ni marcar listo, ni empezar — todo eso lo gobierna la
 *     ficha de silla, que solo se consigue pagando,
 *   · no mueve un centavo.
 *
 * Una sala recién creada es un código y unas condiciones. Pedir identidad para
 * eso protege algo que no existe, y cuesta un usuario.
 *
 * ── Lo que NO se relaja ───────────────────────────────────────────────────
 *
 * Solo se abre la mano en las mesas CON escrow, que son las que tienen un pago
 * después para probar quién eres. En una sala gratis la silla la da la sala, y
 * ahí la sesión sigue siendo obligatoria: sin ella cualquiera se sentaría en
 * cualquier mesa.
 */

export type CreateVerdict =
  /** Hay sesión: el camino de siempre. */
  | { kind: "session" }
  /**
   * Sin sesión, pero la mesa va a cobrar entrada y quien crea dice qué wallet
   * es. La dirección NO está probada y no hace falta que lo esté: solo sirve
   * para que la sala tenga un anfitrión a quien atribuirla. Quien acabe
   * sentado será quien pague, diga lo que diga esto.
   */
  | { kind: "unverified"; address: string }
  /** Ni sesión ni forma de pagar después. */
  | { kind: "denied"; error: "unauthorized" | "invalid_address" };

const ADDR_RE = /^0x[0-9a-f]{40}$/i;

export function decideRoomCreation(input: {
  identity: AppIdentity | null;
  /** Hay contrato de escrow, así que las salas nuevas cobran entrada. */
  escrowed: boolean;
  /** Dirección que dice traer quien crea, si no hay sesión. */
  claimedAddress?: string | null;
}): CreateVerdict {
  if (input.identity) return { kind: "session" };

  // Sala gratis sin sesión: no. Ahí la silla la da la sala y no hay un pago
  // posterior que pruebe nada, así que esto sería sentar a cualquiera.
  if (!input.escrowed) return { kind: "denied", error: "unauthorized" };

  const address = (input.claimedAddress ?? "").trim().toLowerCase();
  if (!ADDR_RE.test(address)) {
    return { kind: "denied", error: "invalid_address" };
  }
  return { kind: "unverified", address };
}

/**
 * ¿Se le puede echar de sus otras salas a quien crea esta?
 *
 * Solo con sesión. `leaveAllRooms` saca a alguien de la mesa donde esté
 * sentado, y hacerlo por una dirección que nadie probó sería regalar una forma
 * de echar a otro de su partida: bastaría con crear una sala diciendo ser él.
 */
export function mayLeaveOtherRooms(verdict: CreateVerdict): boolean {
  return verdict.kind === "session";
}
