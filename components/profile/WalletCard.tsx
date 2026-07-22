"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/wallet";

interface Props {
  address: string;
}

/** Tarjeta de cartera: dirección real, ver completa y copiar con feedback. */
export default function WalletCard({ address }: Props) {
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Portapapeles bloqueado.
    }
  }

  return (
    <section className="profile-section wallet-card">
      <h2 className="section-title">Cartera</h2>
      <p className="section-note">
        Tu cartera en la red Celo. Esta dirección funciona como tu número de
        cuenta para recibir CELO y USDT.
      </p>

      <div className={`wallet-address${full ? " full" : ""}`} aria-live="polite">
        {full ? address : shortAddress(address)}
      </div>

      <div className="wallet-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setFull((f) => !f)}
          aria-label={full ? "Ocultar dirección completa" : "Ver dirección completa"}
        >
          {full ? "Ocultar" : "Ver completa"}
        </button>
        <button
          type="button"
          className="btn-primary wallet-copy-btn"
          onClick={copy}
          aria-label="Copiar dirección de la wallet"
        >
          {copied ? "Dirección copiada ✓" : "Copiar dirección"}
        </button>
      </div>
    </section>
  );
}
