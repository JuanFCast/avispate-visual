"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedWallet, shortAddress } from "@/lib/wallet";

/**
 * Barra de sesión (fase 1 de Privy): iniciar sesión con correo, ver la
 * dirección abreviada de la wallet embebida, copiarla y cerrar sesión.
 * Vive en el menú de inicio; no aparece durante la partida.
 */
export default function AuthBar() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useEmbeddedWallet();
  const [copied, setCopied] = useState(false);

  if (!ready) {
    return <div className="auth-bar auth-bar-muted">Cargando sesión…</div>;
  }

  if (!authenticated) {
    return (
      <div className="auth-bar">
        <button
          type="button"
          className="auth-btn auth-btn-primary"
          onClick={login}
        >
          Iniciar sesión con correo
        </button>
      </div>
    );
  }

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
