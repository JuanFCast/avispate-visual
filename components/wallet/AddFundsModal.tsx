"use client";

import { useEffect, useState } from "react";
import { useIsMiniPay } from "@/lib/minipay";
import { MINIPAY_ADD_CASH, type TokenInfo } from "@/lib/tokens";

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
          aria-label="Cerrar"
        >
          ✕
        </button>
        <h2 className="lobby-modal-title" id="fund-title">
          Agregar {token.symbol}
        </h2>

        {inMiniPay && token.miniPayAddCash ? (
          <>
            <p className="lobby-modal-text">
              MiniPay recarga tu cartera con su propia pantalla, sin salir de
              la aplicación.
            </p>
            <a className="btn-primary fund-cta" href={MINIPAY_ADD_CASH}>
              Agregar dinero en MiniPay
            </a>
          </>
        ) : (
          <>
            <p className="lobby-modal-text">
              Tres formas de conseguir {token.symbol} en la red Celo. Elige la
              que te quede más cómoda.
            </p>

            <ol className="fund-options">
              <li className="fund-option">
                <h3 className="fund-option-title">
                  <span className="fund-option-num">1</span> Recibir en tu
                  dirección
                </h3>
                <p className="fund-option-hint">
                  Si ya tienes {token.symbol} en otro lado, envíalo aquí.{" "}
                  <strong>Solo por la red Celo</strong>: mandarlo por otra red
                  pierde el dinero.
                </p>
                <button
                  type="button"
                  className="fund-copy"
                  onClick={copyAddress}
                >
                  <span className="fund-copy-label">
                    {copied ? "Dirección copiada ✓" : "Copiar mi dirección"}
                  </span>
                  <span className="fund-copy-addr">{address}</span>
                </button>
              </li>

              {token.bridgeUrl && (
                <li className="fund-option">
                  <h3 className="fund-option-title">
                    <span className="fund-option-num">2</span> Traer desde
                    Ethereum
                  </h3>
                  <p className="fund-option-hint">
                    Si tu {token.symbol} está en Ethereum, un puente lo pasa a
                    Celo.
                  </p>
                  <a
                    className="fund-link"
                    href={token.bridgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir el puente (Squid) ↗
                  </a>
                </li>
              )}

              {token.swapUrl && (
                <li className="fund-option">
                  <h3 className="fund-option-title">
                    <span className="fund-option-num">
                      {token.bridgeUrl ? "3" : "2"}
                    </span>{" "}
                    Cambiar dentro de Celo
                  </h3>
                  <p className="fund-option-hint">
                    Si ya tienes otro token en Celo, cámbialo por{" "}
                    {token.symbol}.
                  </p>
                  <a
                    className="fund-link"
                    href={token.swapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir el cambio (Uniswap) ↗
                  </a>
                </li>
              )}
            </ol>

            <p className="fund-foot">
              El puente y el cambio son servicios de terceros: Avíspate no toca
              ese dinero ni cobra nada por ahí.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
