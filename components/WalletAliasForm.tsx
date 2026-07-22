"use client";

import { useState } from "react";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";
import { useActiveWallet, shortAddress } from "@/lib/wallet";

interface Props {
  onSet: (alias: string) => void;
}

/**
 * Alias para jugadores que entran SOLO con wallet (sin correo). El alias se
 * guarda localmente y se reclama en el servidor al enviar la primera jugada
 * paga (el pago on-chain prueba que la wallet es suya).
 */
export default function WalletAliasForm({ onSet }: Props) {
  const { address } = useActiveWallet();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validateAlias(value);
    if (!check.ok || !check.value) {
      setError(check.error ?? "Alias inválido.");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(
        `/api/alias-available?alias=${encodeURIComponent(check.value)}`
      );
      const data = await res.json();
      if (!data.available) {
        setError("Ese alias ya está tomado, elige otro.");
        setChecking(false);
        return;
      }
    } catch {
      // Si la verificación falla, seguimos: el servidor revalida al guardar.
    }
    setChecking(false);
    onSet(check.value);
  }

  return (
    <form className="panel" onSubmit={submit}>
      <p className="hint">
        Wallet conectada: <strong>{shortAddress(address)}</strong>. Elige tu
        alias para el ranking. Con wallet, cada jugada se paga (0.10 USDT).
      </p>
      <div className="field">
        <label>Tu alias</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ALIAS_MAX}
          autoComplete="off"
          aria-label="Alias"
        />
      </div>
      <button type="submit" className="btn-primary" disabled={checking || !value.trim()}>
        {checking ? "Verificando…" : "Continuar"}
      </button>
      {error && <p className="alias-error">{error}</p>}
    </form>
  );
}
