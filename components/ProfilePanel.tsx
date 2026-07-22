"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useReadContract } from "wagmi";
import { celo } from "viem/chains";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet, shortAddress } from "@/lib/wallet";
import { validateAlias, ALIAS_MAX } from "@/lib/alias";
import { USDT_CELO_ADDRESS, ERC20_ABI, USDT_DECIMALS } from "@/lib/contracts";
import WalletConnect from "./WalletConnect";

interface Props {
  /** Alias local de un jugador solo-wallet (sin correo). */
  walletAlias?: string | null;
  /** Persiste el alias local del jugador solo-wallet. */
  onSetWalletAlias?: (alias: string) => void;
}

/**
 * Perfil del jugador en un panel aparte (botón 👤 → modal): alias editable,
 * wallet, saldo USDT y acciones (conectar/cambiar wallet, cerrar sesión).
 */
export default function ProfilePanel({ walletAlias, onSetWalletAlias }: Props) {
  const { authenticated, logout } = usePrivy();
  const { address, isConnected } = useActiveWallet();
  const { alias: privyAlias, setAlias } = useProfile();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const alias = privyAlias ?? walletAlias ?? null;
  const loggedIn = authenticated || isConnected;

  const { data: usdtBal } = useReadContract({
    address: USDT_CELO_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    chainId: celo.id,
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });
  const usdt =
    usdtBal !== undefined
      ? (Number(usdtBal) / 10 ** USDT_DECIMALS).toFixed(2)
      : null;

  if (!loggedIn) return null;

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
    if (authenticated) {
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
    } else {
      // Solo-wallet: verifica disponibilidad y guarda local.
      try {
        const r = await fetch(
          `/api/alias-available?alias=${encodeURIComponent(check.value)}`
        );
        const d = await r.json();
        if (!d.available) {
          setError("Ese alias ya está tomado, elige otro.");
          setSaving(false);
          return;
        }
      } catch {
        // Si falla la verificación, seguimos: el servidor revalida al guardar.
      }
      onSetWalletAlias?.(check.value);
      setSaving(false);
    }
    setEditing(false);
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Portapapeles bloqueado.
    }
  }

  return (
    <>
      <button
        type="button"
        className="profile-trigger"
        onClick={() => setOpen(true)}
        aria-label="Abrir perfil"
      >
        <span aria-hidden="true">👤</span>
        <span className="profile-trigger-name">{alias ?? "Perfil"}</span>
      </button>

      {open && (
        <div
          className="profile-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="profile-card" onClick={(e) => e.stopPropagation()}>
            <div className="profile-card-head">
              <h2>Tu perfil</h2>
              <button
                type="button"
                className="profile-close"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="profile-row">
              <span className="profile-row-label">Alias</span>
              {!editing ? (
                <button
                  type="button"
                  className="profile-row-value profile-alias-edit"
                  onClick={startEdit}
                >
                  {alias ?? "—"} <span aria-hidden="true">✏️</span>
                </button>
              ) : (
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
                    aria-label="Guardar"
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
            </div>
            {error && <p className="alias-error">{error}</p>}

            <div className="profile-row">
              <span className="profile-row-label">Wallet</span>
              {address ? (
                <button
                  type="button"
                  className="profile-row-value"
                  onClick={copyAddress}
                >
                  {shortAddress(address)} · {copied ? "¡copiado!" : "copiar"}
                </button>
              ) : (
                <span className="profile-row-value">Creando…</span>
              )}
            </div>

            <div className="profile-row">
              <span className="profile-row-label">Saldo</span>
              <span className="profile-row-value">💵 {usdt ?? "…"} USDT</span>
            </div>

            <div className="profile-actions">
              <WalletConnect
                className="btn-primary profile-wallet-btn"
                label="Conectar wallet"
                connectedLabel="Cambiar wallet"
              />
              {authenticated && (
                <button
                  type="button"
                  className="profile-logout-btn"
                  onClick={() => {
                    logout();
                    setOpen(false);
                  }}
                >
                  Cerrar sesión
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
