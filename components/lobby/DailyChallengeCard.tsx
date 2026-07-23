"use client";

import type { ReactNode } from "react";
import { fmtUsdt, useDeckPot, useRoundCountdown } from "@/lib/round";
import DeckSelector from "./DeckSelector";

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
  payError: string | null;
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
  payError,
  onPress,
  onShowHowTo,
  children,
}: Props) {
  const { potUnits, potEnabled } = useDeckPot(deckSize);
  const countdown = useRoundCountdown();

  return (
    <section className="lobby-card" aria-label="Reto de hoy">
      <div className="lobby-action">
        <span className="lobby-tag">RETO DE HOY</span>
        <h2 className="lobby-title">Encuentra las parejas. Gasta tu mazo.</h2>
        <p className="lobby-support">
          El menor tiempo promedio por carta gana el premio de hoy.
        </p>

        {/* Altura reservada: el monto llega async y no debe saltar el layout. */}
        <div className="lobby-prize">
          {potEnabled ? (
            <>
              <span className="lobby-prize-label">Premio de hoy</span>
              <span className="lobby-prize-amount">
                {fmtUsdt(potUnits)} USDT
              </span>
              <span className="lobby-prize-close">
                Cierra hoy · 7:00 p. m. COL · faltan {countdown || "…"}
              </span>
            </>
          ) : (
            <span className="lobby-prize-label">Premio en preparación</span>
          )}
        </div>

        <DeckSelector
          value={deckSize}
          onChange={onDeckChange}
          freeByDeck={freeByDeck}
        />

        <p className="lobby-entry" aria-live="polite">
          {cta.support}
        </p>

        <button
          type="button"
          className="btn-primary lobby-cta"
          disabled={cta.disabled}
          onClick={onPress}
        >
          {cta.label}
        </button>

        {payError && (
          <p className="alias-error" aria-live="polite">
            {payError}
          </p>
        )}

        <button
          type="button"
          className="lobby-howto"
          data-howto-trigger
          onClick={onShowHowTo}
        >
          Ver cómo se juega
        </button>
      </div>

      <aside className="lobby-side">{children}</aside>
    </section>
  );
}
