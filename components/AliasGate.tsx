"use client";

import { useState } from "react";
import { useProfile } from "@/lib/profile-context";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";

/**
 * Alias obligatorio tras iniciar sesión con Privy. Si el jugador aún no tiene
 * alias, muestra un formulario para elegirlo; una vez fijado, muestra con
 * quién está jugando. No aparece si no hay sesión (de eso se encarga AuthBar).
 */
export default function AliasGate() {
  const { authenticated, loading, alias, setAlias } = useProfile();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!authenticated) return null;
  if (loading) return <div className="alias-gate alias-gate-muted">Cargando perfil…</div>;

  if (alias) {
    return (
      <div className="alias-gate alias-gate-set">
        Jugando como <strong>{alias}</strong>
      </div>
    );
  }

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
    <form className="alias-gate alias-gate-form" onSubmit={submit}>
      <label className="alias-label" htmlFor="alias-input">
        Elige tu alias para el ranking
      </label>
      <div className="alias-row">
        <input
          id="alias-input"
          className="alias-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ALIAS_MAX}
          placeholder="Tu nombre de jugador"
          autoComplete="off"
        />
        <button
          type="submit"
          className="auth-btn auth-btn-primary alias-save"
          disabled={saving}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {error && <p className="alias-error">{error}</p>}
    </form>
  );
}
