"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, isAddress, parseUnits } from "viem";
import { celo } from "viem/chains";
import { usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { ERC20_ABI } from "@/lib/contracts";
import { resolveFeeCurrency } from "@/lib/pay";
import { formatBalance, type TokenInfo } from "@/lib/tokens";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";

interface Props {
  token: TokenInfo;
  /** Dirección del jugador (la que envía). */
  from: string;
  balance: bigint;
  onClose: () => void;
  /** El envío se confirmó: el perfil vuelve a leer los saldos. */
  onSent: () => void;
}

type Phase = "form" | "sending" | "done";

/**
 * Margen que deja el botón "Máximo" cuando el gas se paga en USDT (CIP-64).
 * Sin él, mandar el saldo completo revierte: la red necesita cobrar la tarifa
 * del MISMO token que se está enviando y ya no queda con qué.
 */
const GAS_MARGIN_USDT = 20_000n; // 0.02 USDT

/** Clasifica un fallo de la wallet o de la red. Devuelve la clave del mensaje. */
function describeSendError(err: unknown): MessageKey {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|User rejected/i.test(msg)) return "send.error.rejected";
  if (/insufficient|exceeds balance|transfer amount/i.test(msg))
    return "send.error.insufficient";
  if (/chain|network/i.test(msg)) return "send.error.chain";
  return "send.error.generic";
}

/**
 * Enviar un token a otra dirección. Solo tokens ERC-20 (USDT y COPm): el CELO
 * nativo no se envía desde aquí porque es con lo que se paga el gas, y vaciarlo
 * dejaría la cartera sin poder firmar nada más.
 *
 * El gas lo decide `resolveFeeCurrency`, la misma función que usa jugar: si la
 * wallet casi no tiene CELO, la tarifa se paga en USDT.
 */
export default function SendModal({
  token,
  from,
  balance,
  onClose,
  onSent,
}: Props) {
  const { t, locale } = useI18n();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<MessageKey | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  /** El gas se cobrará en USDT (CIP-64), no en CELO. */
  const [gasInUsdt, setGasInUsdt] = useState(false);

  // Se resuelve una vez al abrir: decide si el botón "Máximo" debe reservar
  // saldo para la tarifa.
  useEffect(() => {
    let alive = true;
    if (!publicClient) return;
    resolveFeeCurrency(publicClient, from as `0x${string}`)
      .then((o) => {
        if (alive) setGasInUsdt(Boolean(o.feeCurrency));
      })
      .catch(() => {
        // Si no se puede saber, se asume lo seguro: reservar margen.
        if (alive) setGasInUsdt(true);
      });
    return () => {
      alive = false;
    };
  }, [publicClient, from]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "sending") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  /** Lo máximo enviable, ya descontada la reserva de tarifa si aplica. */
  const sendableMax = useCallback((): bigint => {
    if (gasInUsdt && token.symbol === "USDT") {
      return balance > GAS_MARGIN_USDT ? balance - GAS_MARGIN_USDT : 0n;
    }
    return balance;
  }, [balance, gasInUsdt, token.symbol]);

  const validTo = isAddress(to);
  const isSelf = to !== "" && to.toLowerCase() === from.toLowerCase();
  const amountOk = amount !== "" && /^\d*[.,]?\d*$/.test(amount);

  /** El monto escrito, en unidades del token. null si no es un número usable. */
  function parsedAmount(): bigint | null {
    if (!amountOk) return null;
    try {
      const units = parseUnits(amount.replace(",", "."), token.decimals);
      return units > 0n ? units : null;
    } catch {
      return null;
    }
  }

  const units = parsedAmount();
  const overBalance = units !== null && units > balance;
  const canSend =
    phase === "form" && validTo && !isSelf && units !== null && !overBalance;

  async function handleSend() {
    const value = parsedAmount();
    if (!validTo || !value || !token.address || !publicClient) return;
    setError(null);
    setPhase("sending");
    try {
      const feeCurrency = await resolveFeeCurrency(
        publicClient,
        from as `0x${string}`
      );
      // Firmar siempre en Celo: si la wallet está en otra red, se cambia.
      await switchChainAsync({ chainId: celo.id }).catch(() => {
        // Ya estaba en Celo, o la wallet no permite cambiar: el envío de
        // abajo fija chainId y fallará con un mensaje claro si no aplica.
      });
      const hash = await writeContractAsync({
        address: token.address,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to as `0x${string}`, value],
        chainId: celo.id,
        ...feeCurrency,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setPhase("done");
      onSent();
    } catch (err) {
      setError(describeSendError(err));
      setPhase("form");
    }
  }

  const available = formatBalance(
    balance,
    token.decimals,
    token.displayDecimals,
    locale
  );

  return (
    <div
      className="lobby-modal-backdrop"
      onClick={() => phase !== "sending" && onClose()}
    >
      <div
        className="lobby-modal send-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-title"
        onClick={(e) => e.stopPropagation()}
      >
        {phase !== "sending" && (
          <button
            type="button"
            className="lobby-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        )}
        <h2 className="lobby-modal-title" id="send-title">
          {t("send.title", { symbol: token.symbol })}
        </h2>

        {phase === "done" ? (
          <>
            <p className="send-done">{t("send.done")}</p>
            <p className="lobby-modal-text">
              {t("send.done_text", {
                symbol: token.symbol,
                to: `${to.slice(0, 6)}…${to.slice(-4)}`,
              })}
            </p>
            {txHash && (
              <a
                className="fund-link"
                href={`https://celoscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("send.tx_link")}
              </a>
            )}
            <button type="button" className="btn-primary" onClick={onClose}>
              {t("common.done")}
            </button>
          </>
        ) : (
          <>
            <div className="send-available">
              <span className="send-available-label">
                {t("send.available")}
              </span>
              <span className="send-available-value">
                {available} {token.symbol}
              </span>
            </div>

            <div className="send-field">
              <label className="send-label" htmlFor="send-to">
                {t("send.to_label")}
              </label>
              <input
                id="send-to"
                className={`send-input send-input-addr${
                  to !== "" && !validTo ? " is-bad" : ""
                }`}
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                disabled={phase === "sending"}
              />
              {to !== "" && !validTo && (
                <p className="send-warn">{t("send.invalid_addr")}</p>
              )}
              {isSelf && <p className="send-warn">{t("send.self")}</p>}
              <p className="send-note">
                <strong>{t("send.network_note.strong")}</strong>{" "}
                {t("send.network_note.rest")}
              </p>
            </div>

            <div className="send-field">
              <label className="send-label" htmlFor="send-amount">
                {t("send.amount")}
              </label>
              <div className="send-amount-row">
                <input
                  id="send-amount"
                  className={`send-input${overBalance ? " is-bad" : ""}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={phase === "sending"}
                />
                <button
                  type="button"
                  className="btn-ghost send-max"
                  onClick={() =>
                    setAmount(formatUnits(sendableMax(), token.decimals))
                  }
                  disabled={phase === "sending"}
                >
                  {t("send.max")}
                </button>
              </div>
              {overBalance && <p className="send-warn">{t("send.over")}</p>}
              {gasInUsdt && token.symbol === "USDT" && (
                <p className="send-note">{t("send.gas_note")}</p>
              )}
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handleSend}
              disabled={!canSend}
            >
              {phase === "sending"
                ? t("send.sending")
                : t("send.cta", { symbol: token.symbol })}
            </button>
            {phase === "sending" && (
              <p className="empty-note">{t("send.confirm_note")}</p>
            )}
            {error && <p className="alias-error">{t(error)}</p>}
          </>
        )}
      </div>
    </div>
  );
}
