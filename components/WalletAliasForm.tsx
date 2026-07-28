"use client";

import { useState } from "react";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";
import { aliasErrorText } from "@/lib/alias-errors";
import { useActiveWallet, shortAddress } from "@/lib/wallet";
import { useT } from "@/lib/i18n/client";

interface Props {
  onSet: (alias: string) => void;
}

/**
 * Alias para jugadores que entran SOLO con wallet (sin correo). El alias se
 * guarda localmente y se reclama en el servidor al enviar la primera jugada
 * paga (el pago on-chain prueba que la wallet es suya).
 */
export default function WalletAliasForm({ onSet }: Props) {
  const t = useT();
  const { address } = useActiveWallet();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validateAlias(value);
    if (!check.ok || !check.value) {
      setError(aliasErrorText(t, check.error));
      return;
    }
    setChecking(true);
    try {
      // Va la wallet: un alias que ya es de ella no cuenta como "tomado".
      const res = await fetch(
        `/api/alias-available?alias=${encodeURIComponent(check.value)}` +
          (address ? `&wallet=${address}` : "")
      );
      const data = await res.json();
      if (!data.available) {
        setError(t("alias.error.taken_pick"));
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
        {t("alias.wallet_hint.a")} <strong>{shortAddress(address)}</strong>
        {t("alias.wallet_hint.b")}
      </p>
      <div className="field">
        <label>{t("alias.your")}</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ALIAS_MAX}
          autoComplete="off"
          aria-label={t("alias.field")}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={checking || !value.trim()}>
        {checking ? t("alias.checking") : t("common.continue")}
      </button>
      {error && <p className="alias-error">{error}</p>}
    </form>
  );
}
