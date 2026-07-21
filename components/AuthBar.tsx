"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedWallet, shortAddress } from "@/lib/wallet";

/**
 * Barra de sesión: muestra la dirección abreviada de la wallet embebida,
 * permite copiarla y cerrar sesión. Solo aparece cuando hay sesión iniciada;
 * el acceso (login) vive en <AccessCard>.
 */
export default function AuthBar() {
  const { authenticated, logout } = usePrivy();
  const { address } = useEmbeddedWallet();
  const [copied, setCopied] = useState(false);

  if (!authenticated) return null;

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Portapapeles bloqueado (permisos/navegador): no rompemos la UI.
    }
  }

  return (
    <div className="auth-bar">
      {address ? (
        <button
          type="button"
          className="auth-address"
          onClick={copyAddress}
          title="Copiar dirección"
        >
          <span className="auth-dot" aria-hidden="true" />
          <span className="auth-address-value">{shortAddress(address)}</span>
          <span className="auth-copy-hint">{copied ? "¡copiado!" : "copiar"}</span>
        </button>
      ) : (
        <span className="auth-address auth-address-pending">Creando wallet…</span>
      )}
      <button type="button" className="auth-btn" onClick={logout}>
        Cerrar sesión
      </button>
    </div>
  );
}
