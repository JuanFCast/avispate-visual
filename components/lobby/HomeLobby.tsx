"use client";

import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import DailyChallengeCard, { type CtaState } from "./DailyChallengeCard";
import LeaderboardPreview from "./LeaderboardPreview";

interface Props {
  deckSize: number;
  onDeckChange: (deck: number) => void;
  freeByDeck: Record<number, boolean>;
  /** La consulta de jugadas gratis ya respondió al menos una vez. */
  entitlementReady: boolean;
  walletAlias: string | null;
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
  payError,
  onStart,
  onRequestAccess,
  onShowHowTo,
}: Props) {
  const profile = useProfile();
  const wallet = useActiveWallet();

  function computeCta(): CtaState {
    // Sesión resolviendo: el lobby ya es visible, solo el CTA espera.
    if (!profile.ready || (profile.authenticated && profile.loading)) {
      return {
        support: "Comprobando tu entrada…",
        label: "Preparando…",
        disabled: true,
        action: "start",
      };
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
      if (!entitlementReady) {
        return {
          support: "Comprobando tu entrada…",
          label: "Preparando…",
          disabled: true,
          action: "start",
        };
      }
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
    if (wallet.isConnected) {
      if (!walletAlias) {
        return {
          support: "Elige tu alias para guardar tu marca.",
          label: "Continuar",
          disabled: false,
          action: "access",
        };
      }
      return {
        support: "Entrada 0.10 USDT · el ganador se lleva el premio.",
        label: "Jugar por 0.10 USDT",
        disabled: false,
        action: "start",
      };
    }
    return {
      support: "Inicia sesión para revisar tu jugada gratis.",
      label: "Empezar",
      disabled: false,
      action: "access",
    };
  }

  const cta = computeCta();

  return (
    <div className="lobby-wrap">
      <DailyChallengeCard
        deckSize={deckSize}
        onDeckChange={onDeckChange}
        freeByDeck={freeByDeck}
        cta={cta}
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
