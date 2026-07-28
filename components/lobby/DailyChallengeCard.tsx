"use client";

import type { ReactNode } from "react";
import { fmtUsdt, roundCopy, useDeckPot, useRoundClock } from "@/lib/round";
import { useIsMiniPay } from "@/lib/minipay";
import type { PlayStage } from "@/lib/pay";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import PlayButton from "../PlayButton";
import DeckSelector from "./DeckSelector";

/** Deeplink oficial de MiniPay para recargar USDT sin salir de la app. */
const MINIPAY_ADD_CASH = "https://link.minipay.xyz/add_cash?tokens=USDT";

/** Estado calculado del CTA según la matriz de elegibilidad del lobby. */
export interface CtaState {
  /** Mensaje de apoyo sobre la entrada (gratis, pagada o comprobando). */
  support: string;
  label: string;
  disabled: boolean;
  /** "start" arranca el flujo actual; "access" abre el modal contextual. */
  action: "start" | "access";
}

interface Props {
  deckSize: number;
  onDeckChange: (deck: number) => void;
  freeByDeck: Record<number, boolean>;
  cta: CtaState;
  /** Jugada en curso: el lobby sigue visible y solo el CTA cambia. */
  payStage: PlayStage | null;
  payError: MessageKey | null;
  onPress: () => void;
  onShowHowTo: () => void;
  /** Vista previa del ranking: columna derecha en escritorio. */
  children: ReactNode;
}

/**
 * Tarjeta "Reto de hoy": premio, cierre, selector, entrada, CTA y tutorial en
 * una sola unidad. En >=860 px se abre en dos columnas (acción | top 3) sin
 * convertirse en dos tarjetas distintas.
 */
export default function DailyChallengeCard({
  deckSize,
  onDeckChange,
  freeByDeck,
  cta,
  payStage,
  payError,
  onPress,
  onShowHowTo,
  children,
}: Props) {
  const t = useT();
  const { potUnits, potEnabled } = useDeckPot(deckSize);
  const clock = useRoundClock(deckSize);
  const clockCopy = roundCopy(clock, t);
  const inMiniPay = useIsMiniPay();

  return (
    <section className="lobby-card" aria-label={t("lobby.aria")}>
      <div className="lobby-action">
        <span className="lobby-tag">{t("lobby.tag")}</span>
        <h2 className="lobby-title">{t("lobby.title")}</h2>
        <p className="lobby-support">{t("lobby.support")}</p>

        {/* Altura reservada: el monto llega async y no debe saltar el layout. */}
        <div className="lobby-prize">
          {potEnabled ? (
            <>
              <span className="lobby-prize-label">{t("lobby.prize.label")}</span>
              <span className="lobby-prize-amount">
                {fmtUsdt(potUnits)} USDT
              </span>
              {/* El principal cambia cada segundo: sin aria-live para no
                  convertir el lector de pantalla en un metrónomo. */}
              <span className="lobby-prize-close">{clockCopy.primary}</span>
              {clockCopy.retry ? (
                <button
                  type="button"
                  className="lobby-prize-retry"
                  onClick={clock.refetch}
                >
                  {clockCopy.secondary}
                </button>
              ) : (
                <span className="lobby-prize-hint" aria-live="polite">
                  {clockCopy.secondary}
                </span>
              )}
            </>
          ) : (
            <span className="lobby-prize-label">
              {t("lobby.prize.preparing")}
            </span>
          )}
        </div>

        <DeckSelector
          value={deckSize}
          onChange={onDeckChange}
          freeByDeck={freeByDeck}
          /* Con la firma en curso el mazo ya está decidido. */
          disabled={payStage !== null}
        />

        <p className="lobby-entry" aria-live="polite">
          {cta.support}
        </p>

        <PlayButton
          className="lobby-cta"
          label={cta.label}
          stage={payStage}
          disabled={cta.disabled}
          onClick={onPress}
        />

        {payError && (
          <p className="alias-error" aria-live="polite">
            {t(payError)}
            {inMiniPay && payError === "pay.error.insufficient" && (
              <>
                {" "}
                <a className="lobby-addcash" href={MINIPAY_ADD_CASH}>
                  {t("lobby.addcash")}
                </a>
              </>
            )}
          </p>
        )}

        <button
          type="button"
          className="lobby-howto"
          data-howto-trigger
          onClick={onShowHowTo}
        >
          {t("lobby.howto")}
        </button>
      </div>

      <aside className="lobby-side">{children}</aside>
    </section>
  );
}
