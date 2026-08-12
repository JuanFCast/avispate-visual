/**
 * Las dos transacciones de `payAndSit` que mueven dinero de verdad: `approve`
 * (si hace falta) y `join`. Sin React, sin wagmi y sin `fetch` — las firmas y
 * las esperas entran por parámetro, igual que en `arena-register.ts`, para
 * que `scripts/verify-arena-fee-currency.ts` recorra los casos de recibo
 * lento y de cancelación sin montar una wallet ni una cadena.
 */

export interface FeeOverride {
  feeCurrency?: `0x${string}`;
}

/**
 * ── La regla que gobierna `approve` ─────────────────────────────────────
 *
 * `approve` no mueve USDT, solo autoriza. Si su recibo no llega a tiempo, NO
 * se asume ni éxito ni fracaso: se pregunta a la cadena por el permiso de
 * verdad. Si sigue sin alcanzar, no hay nada que cobrar de nuevo —así que la
 * salida es un estado recuperable (`approve_pending`), nunca un reintento a
 * ciegas ni dejar seguir hacia un `join` que revertiría por falta de permiso.
 */
export interface EnsureAllowanceDeps {
  /** Cuánto cuesta la silla. */
  entryUnits: bigint;
  feeCurrency: FeeOverride;
  /** Permiso de USDT actual, leído de la cadena. */
  readAllowance: () => Promise<bigint>;
  /** Firma `approve`. Devuelve el hash. */
  approve: (feeCurrency: FeeOverride) => Promise<string>;
  /** Espera el recibo del approve. Lanza si no llega a tiempo. */
  waitApproveReceipt: (hash: string) => Promise<void>;
  /** Se llama SOLO si de verdad hace falta aprobar — nunca si ya alcanzaba. */
  onApproving?: () => void;
}

export type EnsureAllowanceResult =
  | { kind: "ready" }
  /**
   * El recibo no llegó a tiempo y, al preguntarle a la cadena, el permiso
   * sigue sin alcanzar. Nada se cobró: `approve` no mueve USDT.
   */
  | { kind: "approve_pending"; approveHash: string };

export async function ensureAllowance(
  deps: EnsureAllowanceDeps
): Promise<EnsureAllowanceResult> {
  const allowance = await deps.readAllowance();
  if (allowance >= deps.entryUnits) return { kind: "ready" };

  deps.onApproving?.();
  const approveHash = await deps.approve(deps.feeCurrency);
  try {
    await deps.waitApproveReceipt(approveHash);
    return { kind: "ready" };
  } catch {
    const nowAllowance = await deps.readAllowance();
    // Sigue sin alcanzar: no hay evidencia de que el approve haya cuajado.
    // Firmar `join` ahora revertiría, y volver a firmar `approve` a ciegas
    // podría pisar uno que SÍ va a llegar.
    if (nowAllowance < deps.entryUnits) {
      return { kind: "approve_pending", approveHash };
    }
    // Alcanza: el approve sí llegó, solo el sondeo se tropezó.
    return { kind: "ready" };
  }
}

/**
 * ── La regla que gobierna `join` ────────────────────────────────────────
 *
 * Desde que `join` devuelve un hash, el dinero ya salió. `onJoinHash` se
 * llama ANTES de esperar su recibo —para que quien llama pueda guardar el
 * rastro igual que el reto diario— y un recibo lento NUNCA repite la firma:
 * se sigue con el hash que ya se tiene.
 */
export interface SubmitJoinDeps {
  feeCurrency: FeeOverride;
  /** Firma `join`. Devuelve el hash. */
  join: (feeCurrency: FeeOverride) => Promise<string>;
  /** Espera el recibo del join. Lanza si no llega a tiempo. */
  waitJoinReceipt: (hash: string) => Promise<void>;
  /**
   * El hash de `join` ya existe: el dinero salió. Se llama ANTES de esperar
   * su recibo, nunca después.
   */
  onJoinHash: (hash: string) => void;
}

export async function submitJoin(deps: SubmitJoinDeps): Promise<string> {
  const txHash = await deps.join(deps.feeCurrency);
  deps.onJoinHash(txHash);

  try {
    await deps.waitJoinReceipt(txHash);
  } catch {
    // Sigue adelante con el hash: un timeout aquí no dice "el pago falló".
  }

  return txHash;
}
