"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Tarjeta de acceso al juego. Para jugar es obligatorio iniciar sesión con
 * Privy (correo) y luego elegir alias. El botón "Conectar wallet" es por ahora
 * SOLO visual: no conecta nada ni permite entrar; muestra un aviso de "próximamente".
 * El orden de los botones se inspira en nerdos.fun/grammar, sin copiar su marca.
 */
export default function AccessCard() {
  const { login } = usePrivy();
  const [showWalletNote, setShowWalletNote] = useState(false);

  return (
    <div className="access-card">
      <button
        type="button"
        className="access-btn access-btn-primary"
        onClick={() => login()}
      >
        Continuar con correo
      </button>

      <div className="access-sep">
        <span>o</span>
      </div>

      <button
        type="button"
        className="access-btn access-btn-secondary"
        onClick={() => setShowWalletNote(true)}
      >
        Conectar wallet
      </button>

      {showWalletNote && (
        <p className="access-wallet-note" role="status">
          Conexión de wallet próximamente. Por ahora entra con tu correo. 🔜
        </p>
      )}
    </div>
  );
}
