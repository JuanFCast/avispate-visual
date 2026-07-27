"use client";

import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import type { PlayStage } from "@/lib/pay";
import DailyChallengeCard, { type CtaState } from "./DailyChallengeCard";
import LeaderboardPreview from "./LeaderboardPreview";

interface Props {
  deckSize: number;
  onDeckChange: (deck: number) => void;
  freeByDeck: Record<number, boolean>;
  /** La consulta de jugadas gratis ya respondió al menos una vez. */
  entitlementReady: boolean;
  walletAlias: string | null;
  /** Ya sabemos si la wallet conectada tiene alias en el servidor. */
  walletAliasReady: boolean;
  /** Jugada en curso: el lobby no se va, solo cambia el CTA. */
  payStage: PlayStage | null;
  payError: string | null;
  onStart: (deck: number) => void;
  onRequestAccess: () => void;
  onShowHowTo: () => void;
}

/**
 * Lobby del setup: una sola tarjeta responde "¿qué tengo que hacer para jugar
 * este reto hoy?". La información pública (premio, cierre, top 3) no espera a
 * Privy; solo el chip de entrada y el CTA reflejan la sesión.
 */
export default function HomeLobby({
  deckSize,
  onDeckChange,
  freeByDeck,
  entitlementReady,
  walletAlias,
  walletAliasReady,
  payStage,
  payError,
  onStart,
  onRequestAccess,
  onShowHowTo,
}: Props) {
  const profile = useProfile();
  const wallet = useActiveWallet();

  const checking: CtaState = {
    support: "Comprobando tu entrada…",
    label: "Preparando…",
    disabled: true,
    action: "start",
  };

  function playCta(): CtaState {
    // La jugada gratis del día la decide el CONTRATO por wallet y mazo:
    // aplica igual para correo (wallet embebida), wallet externa y MiniPay.
    if (!entitlementReady) return checking;
    if (freeByDeck[deckSize]) {
      return {
        support: "Tu partida gratis de hoy en este mazo está lista.",
        label: "Jugar gratis",
        disabled: false,
        action: "start",
      };
    }
    return {
      support: "Entrada 0.10 USDT · 80% va al premio.",
      label: "Jugar por 0.10 USDT",
      disabled: false,
      action: "start",
    };
  }

  function computeCta(): CtaState {
    // Sesión resolviendo: el lobby ya es visible, solo el CTA espera.
    if (!profile.ready || (profile.authenticated && profile.loading)) {
      return checking;
    }
    if (profile.authenticated) {
      if (!profile.alias) {
        return {
          support: "Elige tu alias para guardar tu marca.",
          label: "Continuar",
          disabled: false,
          action: "access",
        };
      }
      // La embebida de Privy se conecta sola a wagmi; un instante después
      // de entrar puede no estar lista todavía.
      if (!wallet.isConnected) return checking;
      return playCta();
    }
    if (wallet.isConnected) {
      // Antes de pedir alias hay que saber si la wallet ya tiene uno; si no,
      // a quien vuelve desde otro dispositivo le pediríamos el que ya es suyo.
      if (!walletAliasReady) return checking;
      if (!walletAlias) {
        return {
          support: "Elige tu alias para guardar tu marca.",
          label: "Continuar",
          disabled: false,
          action: "access",
        };
      }
      return playCta();
    }
    return {
      support: "Inicia sesión para revisar tu jugada gratis.",
      label: "Empezar",
      disabled: false,
      action: "access",
    };
  }

  // Con la jugada en curso, el mensaje de apoyo explica qué se está firmando:
  // el jugador tiene el lobby delante y la wallet pidiéndole confirmación.
  function payingCta(base: CtaState): CtaState {
    return {
      ...base,
      support: freeByDeck[deckSize]
        ? "Esta jugada es gratis. Solo debes confirmar en tu wallet."
        : "Confirma el pago de 0,10 USDT en tu wallet.",
    };
  }

  const baseCta = computeCta();
  const cta = payStage ? payingCta(baseCta) : baseCta;

  return (
    <div className="lobby-wrap">
      <DailyChallengeCard
        deckSize={deckSize}
        onDeckChange={onDeckChange}
        freeByDeck={freeByDeck}
        cta={cta}
        payStage={payStage}
        payError={payError}
        onPress={() =>
          cta.action === "access" ? onRequestAccess() : onStart(deckSize)
        }
        onShowHowTo={onShowHowTo}
      >
        <LeaderboardPreview deck={deckSize} />
      </DailyChallengeCard>
    </div>
  );
}
