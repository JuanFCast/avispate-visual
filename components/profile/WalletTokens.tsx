"use client";

import { useState } from "react";
import { celo } from "viem/chains";
import { useBalance, useReadContracts } from "wagmi";
import { ERC20_ABI } from "@/lib/contracts";
import { useIsMiniPay } from "@/lib/minipay";
import { TOKENS, formatBalance, type TokenInfo } from "@/lib/tokens";
import { useI18n } from "@/lib/i18n/client";
import TokenBalanceCard from "./TokenBalanceCard";
import AddFundsModal from "../wallet/AddFundsModal";
import SendModal from "../wallet/SendModal";

interface Props {
  address: string;
}

const REFRESH_MS = 20_000;

/**
 * Los saldos de la cartera con sus acciones (agregar y enviar).
 *
 * Dentro de MiniPay se esconden CELO y COPm y desaparece "Enviar": MiniPay ya
 * trae su propio enviar/recibir y sus reglas de publicación no aceptan ni
 * mostrar tokens fuera de su lista ni mandar al usuario a servicios externos.
 */
export default function WalletTokens({ address }: Props) {
  const { t, locale } = useI18n();
  const inMiniPay = useIsMiniPay();
  const [addFor, setAddFor] = useState<TokenInfo | null>(null);
  const [sendFor, setSendFor] = useState<TokenInfo | null>(null);

  const visible = TOKENS.filter((t) => !(inMiniPay && t.hiddenInMiniPay));
  const erc20 = visible.filter((t) => t.address);

  const celoBal = useBalance({
    address: address as `0x${string}`,
    chainId: celo.id,
    query: { refetchInterval: REFRESH_MS },
  });

  const reads = useReadContracts({
    contracts: erc20.map((t) => ({
      address: t.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [address as `0x${string}`] as const,
      chainId: celo.id,
    })),
    query: { refetchInterval: REFRESH_MS },
  });

  /** Saldo de un token: valor crudo + estado de la lectura. */
  function balanceOf(token: TokenInfo): {
    value: bigint | undefined;
    loading: boolean;
    error: boolean;
  } {
    if (!token.address) {
      return {
        value: celoBal.data?.value,
        loading: celoBal.isLoading,
        error: celoBal.isError,
      };
    }
    const i = erc20.indexOf(token);
    const result = reads.data?.[i];
    return {
      value: result?.status === "success" ? (result.result as bigint) : undefined,
      loading: reads.isLoading,
      error: result?.status === "failure" || reads.isError,
    };
  }

  function refresh() {
    reads.refetch();
    celoBal.refetch();
  }

  return (
    <>
      <section className="token-grid" aria-label={t("tokens.aria")}>
        {visible.map((token) => {
          const { value, loading, error } = balanceOf(token);
          const canAdd = inMiniPay
            ? token.miniPayAddCash
            : Boolean(token.bridgeUrl || token.swapUrl);
          // Enviar solo tiene sentido con saldo y con un token ERC-20. El CELO
          // nativo paga el gas: vaciarlo dejaría la cartera sin firmar nada.
          const canSend =
            !inMiniPay && Boolean(token.address) && (value ?? 0n) > 0n;

          return (
            <TokenBalanceCard
              key={token.symbol}
              symbol={token.symbol}
              tint={token.tint}
              balance={
                value === undefined
                  ? null
                  : formatBalance(
                      value,
                      token.decimals,
                      token.displayDecimals,
                      locale
                    )
              }
              loading={loading}
              error={error}
              description={t(token.descriptionKey)}
              actions={
                canAdd || canSend ? (
                  <>
                    {canAdd && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setAddFor(token)}
                      >
                        {t("tokens.add")}
                      </button>
                    )}
                    {canSend && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setSendFor(token)}
                      >
                        {t("tokens.send")}
                      </button>
                    )}
                  </>
                ) : undefined
              }
            />
          );
        })}
      </section>

      {addFor && (
        <AddFundsModal
          token={addFor}
          address={address}
          onClose={() => setAddFor(null)}
        />
      )}

      {sendFor && (
        <SendModal
          token={sendFor}
          from={address}
          balance={balanceOf(sendFor).value ?? 0n}
          onClose={() => setSendFor(null)}
          onSent={refresh}
        />
      )}
    </>
  );
}
