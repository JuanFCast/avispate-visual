"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useProfile } from "@/lib/profile-context";
import { useWalletAlias } from "@/lib/wallet-alias";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";
import { aliasErrorText } from "@/lib/alias-errors";
import { useT } from "@/lib/i18n/client";

/**
 * Encabezado del perfil: avatar (avispa), "TU PERFIL", alias y editar alias.
 * El alias se administra SOLO aquí (Privy en servidor; solo-wallet en local con
 * verificación de disponibilidad). Requiere sesión iniciada.
 */
export default function ProfileHeader() {
  const t = useT();
  const { authenticated } = usePrivy();
  const { alias: privyAlias, setAlias } = useProfile();
  const { walletAlias, setWalletAlias } = useWalletAlias();

  const alias = privyAlias ?? walletAlias ?? null;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setValue(alias ?? "");
    setError(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validateAlias(value);
    if (!check.ok || !check.value) {
      setError(aliasErrorText(t, check.error));
      return;
    }
    setSaving(true);
    if (authenticated) {
      const res = await setAlias(check.value);
      setSaving(false);
      if (!res.ok) {
        setError(
          res.error === "alias_taken"
            ? t("alias.error.taken_pick")
            : t("alias.error.save_failed_short")
        );
        return;
      }
    } else {
      try {
        const r = await fetch(
          `/api/alias-available?alias=${encodeURIComponent(check.value)}`
        );
        const d = await r.json();
        if (!d.available) {
          setError(t("alias.error.taken_pick"));
          setSaving(false);
          return;
        }
      } catch {
        // El servidor revalida al guardar el puntaje.
      }
      setWalletAlias(check.value);
      setSaving(false);
    }
    setEditing(false);
  }

  return (
    <header className="profile-header">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-avispate.webp" alt="" className="profile-avatar" />
      <p className="profile-eyebrow">{t("profile.eyebrow")}</p>

      {!editing ? (
        <div className="profile-alias-line">
          <h1 className="profile-alias-big">{alias ?? t("profile.no_alias")}</h1>
          <button
            type="button"
            className="profile-alias-editbtn"
            onClick={startEdit}
            aria-label={t("profile.edit_alias")}
          >
            ✏️
          </button>
        </div>
      ) : (
        <form className="profile-alias-editform" onSubmit={save}>
          <input
            className="profile-alias-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={ALIAS_MAX}
            autoFocus
            autoComplete="off"
            aria-label={t("profile.new_alias")}
          />
          <button
            type="submit"
            className="profile-alias-ok"
            disabled={saving || !value.trim()}
            aria-label={t("profile.save_alias")}
          >
            {saving ? "…" : "✓"}
          </button>
          <button
            type="button"
            className="profile-alias-cancel"
            onClick={() => setEditing(false)}
            aria-label={t("common.cancel")}
          >
            ✕
          </button>
        </form>
      )}
      {error && <p className="alias-error">{error}</p>}
    </header>
  );
}
