"use client";

import { usePrivy } from "@privy-io/react-auth";
import WalletConnect from "./WalletConnect";

/**
 * Tarjeta de acceso al juego. La identidad para el ranking sigue siendo el
 * correo (Privy): con correo se crea la wallet embebida y se elige alias. El
 * botón "Conectar wallet" abre el modal de RainbowKit para usar una wallet
 * externa como wallet activa (pagos/premios); no reemplaza al correo como
 * identidad del ranking.
 */
export default function AccessCard() {
  const { login } = usePrivy();

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

      <WalletConnect />
    </div>
  );
}
