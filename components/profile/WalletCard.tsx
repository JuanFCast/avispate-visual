"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/wallet";
import { useIsMiniPay } from "@/lib/minipay";
import { useT } from "@/lib/i18n/client";

interface Props {
  address: string;
}

/**
 * Tarjeta de cartera: dirección real, ver completa y copiar con feedback.
 *
 * Dentro de MiniPay no se muestra: sus reglas de publicación piden no exponer
 * la dirección ahí, porque MiniPay ya tiene sus propias pantallas de recibir
 * y enviar.
 */
export default function WalletCard({ address }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const inMiniPay = useIsMiniPay();

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

  if (inMiniPay) return null;

  return (
    <section className="profile-section wallet-card">
      <h2 className="section-title">{t("wallet.title")}</h2>
      <p className="section-note">{t("wallet.note")}</p>

      <div className={`wallet-address${full ? " full" : ""}`} aria-live="polite">
        {full ? address : shortAddress(address)}
      </div>

      <div className="wallet-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setFull((f) => !f)}
          aria-label={full ? t("wallet.hide_aria") : t("wallet.show_aria")}
        >
          {full ? t("wallet.hide") : t("wallet.show")}
        </button>
        <button
          type="button"
          className="btn-primary wallet-copy-btn"
          onClick={copy}
          aria-label={t("wallet.copy_aria")}
        >
          {copied ? t("wallet.copied") : t("wallet.copy")}
        </button>
      </div>
    </section>
  );
}
