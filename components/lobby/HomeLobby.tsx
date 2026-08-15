"use client";

import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import { useEmbeddedWalletStatus } from "@/lib/embedded-wallet";
import { useIsMiniPay } from "@/lib/minipay";
import { FEE_AMOUNT } from "@/lib/contracts";
import { fmtUsdt } from "@/lib/round";
import type { PlayStage } from "@/lib/pay";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { decideLobbyCta } from "@/lib/lobby-cta";
import type { PayBlock } from "../GameShell";
import ArenaCard from "./ArenaCard";
import DailyChallengeCard, { type CtaState } from "./DailyChallengeCard";
import LeaderboardPreview from "./LeaderboardPreview";

interface Props {
  /**
   * Viene de `ConnectModalBridge` vía `GameShell`, no de `useConnectModal()`
   * directo: así el lobby no arrastra RainbowKit por su cuenta. `null` hasta
   * que el puente esté listo (o siempre, dentro de MiniPay) — se usa igual
   * que antes: como valor truthy/callable, nunca se distingue el motivo.
   */
  openConnectModal: (() => void) | null;
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
  payError: MessageKey | null;
  payBlock: PayBlock | null;
  onStart: (deck: number) => void;
  onRequestAccess: () => void;
  onReconnect: () => void;
  onPickAnotherName: () => void;
  onResumePending: () => void;
  onShowHowTo: () => void;
}

/**
 * Lobby del setup: dos tarjetas y una elección, "¿juego solo o compito contra
 * otras personas?". Primero el reto diario, que se juega hoy y trae todo lo
 * suyo (premio, cierre, mazo, entrada, CTA y top 3), y debajo la Arena, que
 * todavía no existe como partida y solo enseña lo que viene.
 *
 * La información pública del reto no espera a Privy; solo el chip de entrada y
 * el CTA reflejan la sesión.
 */
export default function HomeLobby({
  openConnectModal,
  deckSize,
  onDeckChange,
  freeByDeck,
  entitlementReady,
  walletAlias,
  walletAliasReady,
  payStage,
  payError,
  payBlock,
  onStart,
  onRequestAccess,
  onReconnect,
  onPickAnotherName,
  onResumePending,
  onShowHowTo,
}: Props) {
  const t = useT();
  const profile = useProfile();
  const wallet = useActiveWallet();
  const embeddedWallet = useEmbeddedWalletStatus();
  const inMiniPay = useIsMiniPay();
  // El precio sale del contrato configurado, no de una frase escrita a mano:
  // el día que la entrada cambie, el botón cambia con ella.
  const fee = fmtUsdt(FEE_AMOUNT);

  /**
   * La decisión entera vive en `lib/lobby-cta.ts`, pura y probada. Aquí solo se
   * reúnen los hechos y se traduce el resultado: era la única decisión del
   * camino de pago que no se podía correr sin un navegador, y por eso el fallo
   * de "abandono la partida y ya no puedo empezar otra" no lo cazaba nadie.
   */
  const decision = decideLobbyCta({
    blockedByPending:
      payBlock?.kind === "resume_pending" || payBlock?.kind === "payer_mismatch",
    profileReady: profile.ready,
    authenticated: profile.authenticated,
    profileLoading: profile.loading,
    profileFailed: profile.failed,
    profileAlias: profile.alias,
    walletConnected: wallet.isConnected,
    walletReconnecting: wallet.reconnecting,
    embeddedStatus: embeddedWallet.status,
    inMiniPay,
    canOpenConnectModal: Boolean(openConnectModal),
    walletAliasReady,
    walletAlias,
    entitlementReady,
    freeForDeck: Boolean(freeByDeck[deckSize]),
  });

  const baseCta: CtaState = {
    support: t(decision.support, { fee }),
    label: t(decision.label, { fee }),
    disabled: decision.disabled,
    action: decision.action,
  };

  // Con la jugada en curso, el mensaje de apoyo explica qué se está firmando:
  // el jugador tiene el lobby delante y la wallet pidiéndole confirmación.
  const cta: CtaState = payStage
    ? {
        ...baseCta,
        support: freeByDeck[deckSize]
          ? t("cta.paying.free")
          : t("cta.paying.paid", { fee }),
      }
    : baseCta;

  return (
    <div className="lobby-wrap">
      <DailyChallengeCard
        deckSize={deckSize}
        onDeckChange={onDeckChange}
        freeByDeck={freeByDeck}
        cta={cta}
        payStage={payStage}
        payError={payError}
        payBlock={payBlock}
        onReconnect={onReconnect}
        onPickAnotherName={onPickAnotherName}
        onResumePending={onResumePending}
        onPress={() => {
          if (cta.action === "resume") return onResumePending();
          if (cta.action === "access") return onRequestAccess();
          if (cta.action === "connect") return openConnectModal?.();
          if (cta.action === "retry") return embeddedWallet.retry();
          if (cta.action === "reload") return void profile.refresh();
          onStart(deckSize);
        }}
        onShowHowTo={onShowHowTo}
      >
        <LeaderboardPreview deck={deckSize} />
      </DailyChallengeCard>

      <ArenaCard />
    </div>
  );
}
