"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import { useEmbeddedWalletStatus } from "@/lib/embedded-wallet";
import { useIsMiniPay } from "@/lib/minipay";
import { FEE_AMOUNT } from "@/lib/contracts";
import { fmtUsdt } from "@/lib/round";
import type { PlayStage } from "@/lib/pay";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import type { PayBlock } from "../GameShell";
import ArenaCard from "./ArenaCard";
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
  const { openConnectModal } = useConnectModal();
  // El precio sale del contrato configurado, no de una frase escrita a mano:
  // el día que la entrada cambie, el botón cambia con ella.
  const fee = fmtUsdt(FEE_AMOUNT);

  const checking: CtaState = {
    support: t("cta.checking.support"),
    label: t("cta.checking.label"),
    disabled: true,
    action: "start",
  };

  /**
   * Entró con su correo pero todavía no hay wallet con la que firmar.
   *
   * Antes esto era el mismo "Preparando…" de siempre, y cuando la creación se
   * atascaba el jugador se quedaba mirando un botón muerto sin saber si la
   * culpa era suya, del internet o de la app: la única salida era recargar. Se
   * cuenta lo que está pasando y, si tarda de más, se le da el botón.
   */
  function walletCta(): CtaState {
    /**
     * Privy no tiene sesión. Aquí estaba el callejón sin salida.
     *
     * Se llega a esta función porque `profile.authenticated` dijo que sí, y ese
     * valor es `privyAuth || walletSession`. Con la sesión sin firma suelta en
     * el almacenamiento —la que nadie limpiaba al cerrar sesión— pasaba esto:
     * el perfil contaba como autenticado, Privy no, y `status` quedaba en
     * "idle". Sin wallet conectada, esta rama devolvía "Preparando…" y ahí se
     * quedaba PARA SIEMPRE: no había nada cargando, era una contradicción entre
     * dos formas de contestar "¿hay sesión?". Por eso ningún tiempo de espera lo
     * destrababa, y por eso `/perfil` decía "inicia sesión" mientras el lobby
     * seguía preparando algo.
     *
     * Nadie va a crear ni conectar nada aquí. Lo honesto es ofrecer entrar.
     */
    if (embeddedWallet.status === "idle") {
      // Salvo que wagmi siga reenganchando de verdad: eso sí es esperar a algo.
      if (wallet.reconnecting) return checking;
      return {
        support: t("cta.login.support"),
        label: t("cta.login.label"),
        disabled: false,
        action: "access",
      };
    }
    // Entró firmando con su propia billetera y ahora no está conectada. Esto
    // no se arregla esperando —la firma la da él—, así que el botón abre el
    // conector en vez de dejarlo mirando un "Preparando…" eterno.
    if (embeddedWallet.status === "external") {
      return {
        support: t("cta.wallet.external.support"),
        label: t("cta.wallet.external.label"),
        disabled: !openConnectModal,
        action: "connect",
      };
    }
    if (embeddedWallet.status === "stuck") {
      return {
        support: t("cta.wallet.stuck.support"),
        label: t("cta.wallet.stuck.label"),
        disabled: false,
        action: "retry",
      };
    }
    return {
      support:
        embeddedWallet.status === "connecting"
          ? t("cta.wallet.connecting.support")
          : t("cta.wallet.creating.support"),
      label: t("cta.wallet.creating.label"),
      disabled: true,
      action: "start",
    };
  }

  function playCta(): CtaState {
    // La jugada gratis del día la decide el CONTRATO por wallet y mazo:
    // aplica igual para correo (wallet embebida), wallet externa y MiniPay.
    if (!entitlementReady) return checking;
    if (freeByDeck[deckSize]) {
      return {
        support: t("cta.free.support"),
        label: t("cta.free.label"),
        disabled: false,
        action: "start",
      };
    }
    return {
      support: t("cta.paid.support", { fee }),
      label: t("cta.paid.label", { fee }),
      disabled: false,
      action: "start",
    };
  }

  function computeCta(): CtaState {
    /**
     * Candado contra el segundo cobro. Va PRIMERO: mientras haya una jugada
     * pagada sin registrar, el botón no puede ofrecer jugar —llamaría otra vez
     * al contrato y cobraría de nuevo, y encima como paga, porque la gratis
     * del día ya se consumió—.
     */
    if (payBlock?.kind === "resume_pending" || payBlock?.kind === "payer_mismatch") {
      return {
        support: t("cta.resume.support"),
        label: t("cta.resume.label"),
        disabled: false,
        action: "resume",
      };
    }
    // Sesión resolviendo: el lobby ya es visible, solo el CTA espera.
    if (!profile.ready || (profile.authenticated && profile.loading)) {
      return checking;
    }
    // wagmi reenganchando la wallet de siempre: se espera en vez de ofrecerle
    // entrar. Es un parpadeo corto, pero es el que hace pensar al jugador que
    // la sesión no se guardó.
    if (wallet.reconnecting) return checking;
    /**
     * El perfil no se pudo cargar. NO es un jugador sin alias.
     *
     * Antes daban lo mismo: `refresh()` guardaba `EMPTY` al fallar y esta rama
     * leía `alias: null` como "elige un nombre" — a alguien que lleva meses con
     * el suyo. Se ofrece reintentar, que es lo que de verdad falta.
     */
    if (profile.authenticated && profile.failed) {
      return {
        support: t("cta.profile_failed.support"),
        label: t("cta.profile_failed.label"),
        disabled: false,
        action: "reload",
      };
    }
    if (profile.authenticated) {
      if (!profile.alias) {
        return {
          support: t("cta.alias.support"),
          label: t("cta.alias.label"),
          disabled: false,
          action: "access",
        };
      }
      // La embebida de Privy se conecta sola a wagmi; un instante después
      // de entrar puede no estar lista todavía.
      if (!wallet.isConnected) return walletCta();
      return playCta();
    }
    if (wallet.isConnected) {
      /**
       * Wallet puesta pero sin sesión. FUERA de MiniPay se pide la firma: una
       * dirección conectada es un dato que dice el navegador, no una cuenta, y
       * tener dos clases de jugador —unos con sesión y otros solo conectados—
       * es la raíz de los líos de identidad. Firmar es gratis y no mueve fondos.
       *
       * Dentro de MiniPay no se puede firmar (esa wallet no tiene firma de
       * mensajes), y no hace falta: ahí la sesión la abre la propia jugada, con
       * el hash de la transacción como prueba. Por eso ese camino se queda como
       * estaba, pidiendo alias y a jugar.
       */
      if (!inMiniPay) {
        return {
          support: t("cta.sign.support"),
          label: t("cta.sign.label"),
          disabled: false,
          action: "access",
        };
      }
      // Antes de pedir alias hay que saber si la wallet ya tiene uno; si no,
      // a quien vuelve desde otro dispositivo le pediríamos el que ya es suyo.
      if (!walletAliasReady) return checking;
      if (!walletAlias) {
        return {
          support: t("cta.alias.support"),
          label: t("cta.alias.label"),
          disabled: false,
          action: "access",
        };
      }
      return playCta();
    }
    return {
      support: t("cta.login.support"),
      label: t("cta.login.label"),
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
        ? t("cta.paying.free")
        : t("cta.paying.paid", { fee }),
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
