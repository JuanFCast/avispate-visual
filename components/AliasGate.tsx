"use client";

import { useState } from "react";
import { useProfile } from "@/lib/profile-context";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";
import { aliasErrorText } from "@/lib/alias-errors";
import { useT } from "@/lib/i18n/client";

/**
 * Creación del alias (username) la primera vez. Es obligatorio para jugar y se
 * elige una sola vez; luego se cambia desde el perfil (el lápiz en la barra de
 * sesión). GameShell solo monta esto cuando el jugador aún no tiene alias.
 */
export default function AliasGate() {
  const t = useT();
  const { setAlias } = useProfile();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validateAlias(value);
    if (!check.ok || !check.value) {
      setError(aliasErrorText(t, check.error));
      return;
    }
    setSaving(true);
    const res = await setAlias(check.value);
    setSaving(false);
    if (!res.ok) {
      setError(
        res.error === "alias_taken"
          ? t("alias.error.taken_try")
          : aliasErrorText(t, res.error, "alias.error.save_failed")
      );
    }
  }

  return (
    <form className="panel alias-setup" onSubmit={submit}>
      <div className="field">
        <label htmlFor="alias-input">{t("alias.create")}</label>
        <input
          id="alias-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ALIAS_MAX}
          placeholder={t("alias.placeholder")}
          autoComplete="off"
          autoFocus
        />
      </div>
      <button type="submit" className="btn-primary" disabled={saving || !value.trim()}>
        {saving ? t("alias.saving") : t("alias.save")}
      </button>
      {error && <p className="alias-error">{error}</p>}
      <p className="hint">{t("alias.hint")}</p>
    </form>
  );
}
