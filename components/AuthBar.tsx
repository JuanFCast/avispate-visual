"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet, shortAddress } from "@/lib/wallet";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";
import WalletConnect from "./WalletConnect";

/**
 * Barra de perfil: alias (username) con edición inline vía lápiz, dirección de
 * la wallet embebida (copiable) y cerrar sesión. Solo aparece con sesión
 * iniciada. El alias se elige una vez en <AliasGate>; aquí se cambia.
 */
export default function AuthBar() {
  const { authenticated, logout } = usePrivy();
  // Wallet ACTIVA de wagmi: embebida por defecto, o la externa que conecte.
  const { address } = useActiveWallet();
  const { alias, setAlias } = useProfile();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!authenticated) return null;

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Portapapeles bloqueado: no rompemos la UI.
    }
  }

  function startEdit() {
    setValue(alias ?? "");
    setError(null);
    setEditing(true);
  }

  async function saveAlias(e: React.FormEvent) {
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
          ? "Ese alias ya está tomado."
          : "No se pudo guardar."
      );
      return;
    }
    setEditing(false);
  }

  return (
    <div className="profile-bar">
      <div className="profile-info">
        {alias && !editing && (
          <button
            type="button"
            className="profile-alias"
            onClick={startEdit}
            title="Editar alias"
          >
            <span className="profile-alias-name">{alias}</span>
            <span className="profile-edit" aria-hidden="true">
              ✏️
            </span>
          </button>
        )}

        {editing && (
          <form className="profile-edit-form" onSubmit={saveAlias}>
            <input
              className="profile-edit-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={ALIAS_MAX}
              autoFocus
              autoComplete="off"
              aria-label="Nuevo alias"
            />
            <button
              type="submit"
              className="profile-edit-ok"
              disabled={saving || !value.trim()}
              aria-label="Guardar alias"
            >
              {saving ? "…" : "✓"}
            </button>
            <button
              type="button"
              className="profile-edit-cancel"
              onClick={() => setEditing(false)}
              aria-label="Cancelar"
            >
              ✕
            </button>
          </form>
        )}

        {address ? (
          <button
            type="button"
            className="profile-wallet"
            onClick={copyAddress}
            title="Copiar dirección"
          >
            <span className="auth-dot" aria-hidden="true" />
            <span className="profile-wallet-value">{shortAddress(address)}</span>
            <span className="profile-copy">{copied ? "¡copiado!" : "copiar"}</span>
          </button>
        ) : (
          <span className="profile-wallet profile-wallet-pending">
            Creando wallet…
          </span>
        )}
      </div>

      <WalletConnect
        className="auth-btn profile-logout"
        label="Conectar wallet"
        connectedLabel="Cambiar wallet"
      />

      <button type="button" className="auth-btn profile-logout" onClick={logout}>
        Salir
      </button>

      {editing && error && <p className="alias-error profile-error">{error}</p>}
    </div>
  );
}
