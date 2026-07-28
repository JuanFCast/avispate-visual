"use client";

import { useEffect, useState } from "react";
import { useIsMiniPay } from "@/lib/minipay";
import { MINIPAY_ADD_CASH, type TokenInfo } from "@/lib/tokens";
import { useT } from "@/lib/i18n/client";

interface Props {
  token: TokenInfo;
  /** Dirección del jugador, para recibir desde otra parte. */
  address: string;
  onClose: () => void;
}

/**
 * "Agregar dinero" a la cartera. Dos pantallas distintas según dónde esté el
 * jugador:
 *
 * - Dentro de MiniPay: un solo botón a su pantalla nativa de recarga. Sus
 *   reglas de publicación PROHÍBEN mandar al usuario a puentes o exchanges
 *   externos, así que las tres opciones de abajo no pueden aparecer ahí.
 * - En un navegador normal: recibir en tu dirección, traer desde Ethereum con
 *   un puente, o cambiar otro token dentro de Celo.
 *
 * Ningún camino mueve dinero desde aquí: todos terminan en la wallet del
 * jugador o en un servicio de terceros que él controla.
 */
export default function AddFundsModal({ token, address, onClose }: Props) {
  const t = useT();
  const inMiniPay = useIsMiniPay();
  const [copied, setCopied] = useState(false);

  // Escape cierra, igual que el resto de modales del juego.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Portapapeles bloqueado: la dirección sigue visible para copiarla a mano.
    }
  }

  return (
    <div className="lobby-modal-backdrop" onClick={onClose}>
      <div
        className="lobby-modal fund-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fund-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="lobby-modal-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          ✕
        </button>
        <h2 className="lobby-modal-title" id="fund-title">
          {t("fund.title", { symbol: token.symbol })}
        </h2>

        {inMiniPay && token.miniPayAddCash ? (
          <>
            <p className="lobby-modal-text">{t("fund.minipay.text")}</p>
            <a className="btn-primary fund-cta" href={MINIPAY_ADD_CASH}>
              {t("fund.minipay.cta")}
            </a>
          </>
        ) : (
          <>
            <p className="lobby-modal-text">
              {t("fund.intro", { symbol: token.symbol })}
            </p>

            <ol className="fund-options">
              <li className="fund-option">
                <h3 className="fund-option-title">
                  <span className="fund-option-num">1</span>{" "}
                  {t("fund.opt1.title")}
                </h3>
                <p className="fund-option-hint">
                  {t("fund.opt1.hint.a", { symbol: token.symbol })}{" "}
                  <strong>{t("fund.opt1.hint.strong")}</strong>
                  {t("fund.opt1.hint.b")}
                </p>
                <button
                  type="button"
                  className="fund-copy"
                  onClick={copyAddress}
                >
                  <span className="fund-copy-label">
                    {copied ? t("wallet.copied") : t("fund.copy")}
                  </span>
                  <span className="fund-copy-addr">{address}</span>
                </button>
              </li>

              {token.bridgeUrl && (
                <li className="fund-option">
                  <h3 className="fund-option-title">
                    <span className="fund-option-num">2</span>{" "}
                    {t("fund.opt2.title")}
                  </h3>
                  <p className="fund-option-hint">
                    {t("fund.opt2.hint", { symbol: token.symbol })}
                  </p>
                  <a
                    className="fund-link"
                    href={token.bridgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("fund.opt2.link")}
                  </a>
                </li>
              )}

              {token.swapUrl && (
                <li className="fund-option">
                  <h3 className="fund-option-title">
                    <span className="fund-option-num">
                      {token.bridgeUrl ? "3" : "2"}
                    </span>{" "}
                    {t("fund.opt3.title")}
                  </h3>
                  <p className="fund-option-hint">
                    {t("fund.opt3.hint", { symbol: token.symbol })}
                  </p>
                  <a
                    className="fund-link"
                    href={token.swapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("fund.opt3.link")}
                  </a>
                </li>
              )}
            </ol>

            <p className="fund-foot">{t("fund.foot")}</p>
          </>
        )}
      </div>
    </div>
  );
}
