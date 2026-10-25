/**
 * Qué salió mal en una transacción, leído del CÓDIGO y del TIPO de error —
 * nunca del texto del mensaje.
 *
 * Es regla de publicación de MiniPay ("map errors from codes, not message
 * text"), y además es lo correcto: el texto cambia con la versión de la wallet
 * y con su idioma, el código no. Antes cada pantalla buscaba "rejected" o
 * "insufficient" dentro del mensaje, y una wallet en español que dijera
 * "rechazado" caía en "algo salió mal".
 *
 * Puro y sin dependencias: lo recorre `scripts/verify-tx-errors.ts` con `node`.
 */

export type TxErrorKind =
  /** La persona canceló la firma en su wallet (EIP-1193 4001). */
  | "rejected"
  /** La red pidió su tarifa en moneda nativa y la wallet no tiene. */
  | "fee_native"
  /** El contrato rechazó el cobro porque el saldo o el permiso no alcanzan. */
  | "insufficient"
  /** La wallet está en otra red o no pudo cambiar a Celo. */
  | "chain"
  | "unknown";

interface ErrorLike {
  code?: unknown;
  name?: unknown;
  cause?: unknown;
  data?: { errorName?: unknown };
}

/** EIP-1193: la persona rechazó la petición. */
const USER_REJECTED = 4001;
/** EIP-1193 / EIP-3085: red desconocida para la wallet, o desconectada de ella. */
const CHAIN_CODES = new Set([4901, 4902]);

/** Errores de ERC-20 (OpenZeppelin 5) que dicen "no alcanza". */
const INSUFFICIENT_ERRORS = new Set([
  "ERC20InsufficientBalance",
  "ERC20InsufficientAllowance",
]);

/** El error y todas sus causas: viem envuelve el de la wallet varias capas. */
function* chainOf(err: unknown): Generator<ErrorLike> {
  let current: unknown = err;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    yield current as ErrorLike;
    current = (current as ErrorLike).cause;
  }
}

export function classifyTxError(err: unknown): TxErrorKind {
  for (const e of chainOf(err)) {
    if (e.code === USER_REJECTED || e.name === "UserRejectedRequestError") {
      return "rejected";
    }
    if (
      (typeof e.code === "number" && CHAIN_CODES.has(e.code)) ||
      e.name === "ChainMismatchError" ||
      e.name === "SwitchChainError" ||
      e.name === "ChainNotConfiguredError"
    ) {
      return "chain";
    }
    // viem lo pone cuando el nodo responde "insufficient funds for gas *
    // price + value": falta la moneda NATIVA, no el USDT.
    if (e.name === "InsufficientFundsError") return "fee_native";
    if (
      typeof e.data?.errorName === "string" &&
      INSUFFICIENT_ERRORS.has(e.data.errorName)
    ) {
      return "insufficient";
    }
  }
  return "unknown";
}
