"use client";

import type { ReactNode } from "react";

interface Props {
  symbol: string;
  /** Tinte de color: celo | usdt | copm. */
  tint: string;
  /** Saldo formateado, o null mientras carga. */
  balance: string | null;
  loading: boolean;
  error?: boolean;
  description: string;
  /** Botones de acción (Enviar / Agregar…). */
  actions?: ReactNode;
  /** Etiqueta de "próximamente" si el token aún no está soportado. */
  soon?: boolean;
}

/** Tarjeta de saldo de un token, con skeleton, error y estado cero. */
export default function TokenBalanceCard({
  symbol,
  tint,
  balance,
  loading,
  error,
  description,
  actions,
  soon,
}: Props) {
  return (
    <div className={`token-card tint-${tint}${soon ? " token-soon" : ""}`}>
      <div className="token-head">
        <span className="token-symbol">{symbol}</span>
        {soon ? (
          <span className="token-badge">Próximamente</span>
        ) : loading ? (
          <span className="skeleton skeleton-balance" aria-label="Cargando saldo" />
        ) : error ? (
          <span className="token-balance token-balance-err">— error</span>
        ) : (
          <span className="token-balance">{balance ?? "0"}</span>
        )}
      </div>
      <p className="token-desc">{description}</p>
      {actions && <div className="token-actions">{actions}</div>}
    </div>
  );
}
