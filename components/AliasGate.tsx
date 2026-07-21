"use client";

import { useState } from "react";
import { useProfile } from "@/lib/profile-context";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";

/**
 * Creación del alias (username) la primera vez. Es obligatorio para jugar y se
 * elige una sola vez; luego se cambia desde el perfil (el lápiz en la barra de
 * sesión). GameShell solo monta esto cuando el jugador aún no tiene alias.
 */
export default function AliasGate() {
  const { setAlias } = useProfile();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validateAlias(value);
    if (!check.ok || !check.value) {
      setError(check.error ?? "Alias inválido.");
      return;
    }
    setSaving(true);
    const res = await setAlias(check.value);
    setSaving(false);
    if (!res.ok) {
      setError(
        res.error === "alias_taken"
          ? "Ese alias ya está tomado, prueba otro."
          : res.error ?? "No se pudo guardar el alias."
      );
    }
  }

  return (
    <form className="panel alias-setup" onSubmit={submit}>
      <div className="field">
        <label htmlFor="alias-input">Crea tu alias</label>
        <input
          id="alias-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ALIAS_MAX}
          placeholder="Ej: Vale"
          autoComplete="off"
          autoFocus
        />
      </div>
      <button type="submit" className="btn-primary" disabled={saving || !value.trim()}>
        {saving ? "Guardando…" : "Guardar y continuar"}
      </button>
      {error && <p className="alias-error">{error}</p>}
      <p className="hint">
        Así te verán en el ranking. Es único y lo eliges una vez; luego puedes
        cambiarlo desde tu perfil. 🐝
      </p>
    </form>
  );
}
