"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  computeAccuracy,
  generateFirstCard,
  generateNextCard,
  ERROR_PENALTY_MS,
  type ChainCard,
  type GameResult,
} from "@/lib/game";
import { loadLeaderboard, saveResult } from "@/lib/leaderboard";
import { isMuted, setMuted, sound, unlockAudio } from "@/lib/sound";
import { useProfile } from "@/lib/profile-context";
import {
  InsufficientFundsError,
  WalletChangedError,
  usePayToPlay,
  type PlayStage,
} from "@/lib/pay";
import { fmtUsdt, refreshLeaderboard, useFreePlays } from "@/lib/round";
import { FEE_AMOUNT } from "@/lib/contracts";
import {
  BLOCKING_DELAYS,
  deliver,
  enqueue,
  pending,
  pendingPlay,
  repairPendingPlayer,
} from "@/lib/outbox";
import {
  decidePlayStart,
  type PayDecision,
  type PendingPlay,
} from "@/lib/pay-guard";
import { probeWallet } from "@/lib/wallet-access";
import { useIsMiniPay } from "@/lib/minipay";
import { useActiveWallet, useCanonicalWallet } from "@/lib/wallet";
import { checkAliasBeforePaying } from "@/lib/alias-claim";
import { useWalletAlias } from "@/lib/wallet-alias";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { HowToPlay, useHowToPlay } from "./HowToPlay";
import HomeLobby from "./lobby/HomeLobby";
import StartAccessModal from "./lobby/StartAccessModal";
import ProfileBottomNav from "./profile/ProfileBottomNav";
import CardView from "./CardView";
import GameHUD from "./GameHUD";
import ResultsPanel from "./ResultsPanel";

/**
 * No hay fase de "pagando": la jugada se procesa sobre la pantalla en la que
 * empezó (lobby o resultados), que sigue montada mientras `payStage` cuenta
 * el avance en el botón. Sin pantalla intermedia y sin perder el contexto.
 */
type Phase = "setup" | "countdown" | "playing" | "results";
type Role = "base" | "incoming" | "exiting";

interface VisualCard {
  card: ChainCard;
  role: Role;
  /** Recién repartida: entra con animación de mazo. */
  fresh: boolean;
}

interface Feedback {
  cardId: number;
  symbolId: string;
  type: "good" | "bad";
}

const EXIT_ANIMATION_MS = 600;
const FINAL_CARD_DELAY_MS = 650;
/**
 * Transición entre la transacción confirmada y el 3, 2, 1. Lo justo para leer
 * "Preparando partida…" en el botón; la cuenta regresiva arranca sola.
 */
const HANDOFF_MS = 450;

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

/**
 * Clasifica un error del flujo de jugada. Devuelve la CLAVE del mensaje, no la
 * frase: el idioma se resuelve al pintar, y así el lobby puede reconocer el
 * caso de saldo insuficiente para ofrecer la recarga.
 *
 * La entrada (USDT) y la tarifa de red (el gas) se cuentan por separado. Antes
 * no: cualquier error que dijera "insufficient" se traducía como "te falta
 * USDT", y a un jugador con USDT de sobra le decía que no tenía cuando lo que
 * le faltaba era CELO para el gas.
 */
function describePayError(err: unknown): MessageKey {
  if (err instanceof InsufficientFundsError) {
    // Aquí el saldo se leyó antes de firmar: si no alcanza para la tarifa es
    // porque tampoco hay USDT (con CELO se habría pagado con CELO).
    return err.missing === "gas"
      ? "pay.error.fee_usdt"
      : "pay.error.insufficient";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|User rejected/i.test(msg)) return "pay.error.rejected";
  // "insufficient funds for gas * price + value" y compañía: la red pidió su
  // tarifa en moneda nativa y la wallet no tiene CELO. Va antes del caso
  // general porque ese texto también dice "insufficient" y se lo llevaba todo.
  if (
    /insufficient funds|gas required exceeds|intrinsic transaction cost|max fee per gas/i.test(
      msg
    )
  )
    return "pay.error.fee_celo";
  if (/insufficient|exceeds balance|transfer amount/i.test(msg))
    return "pay.error.insufficient";
  if (/pot_not_configured/.test(msg)) return "pay.error.not_configured";
  if (/no_wallet/.test(msg)) return "pay.error.no_wallet";
  return "pay.error.generic";
}

/**
 * La jugada se pagó pero el servidor no la confirmó. Lo importante que hay que
 * decirle al jugador es que NO vuelva a pagar: su jugada quedó guardada en el
 * teléfono y se registra sola en cuanto haya conexión.
 */
function describeRegisterError(result: "rejected" | "retry"): MessageKey {
  return result === "retry" ? "pay.register.retry" : "pay.register.rejected";
}

/**
 * Por qué el cobro está parado. Ninguno de estos casos se arregla reintentando
 * solo: los cuatro primeros necesitan que la persona haga algo, y el último es
 * una jugada YA PAGADA esperando a que el servidor la acepte.
 */
export type PayBlock =
  /** La wallet no confirmó su cuenta (bloqueada, sin permiso, sin responder). */
  | { kind: "reconnect" }
  /** La wallet expone otra cuenta distinta a la que la app tenía validada. */
  | { kind: "account_changed"; actual: string }
  /**
   * La wallet que iba a firmar no es la del perfil. Se nombra la que manda para
   * que no haya duda de cuál conectar: es la que tiene el historial y cobra.
   */
  | { kind: "wrong_wallet"; canonical: string; connected: string }
  /** Aún no se sabe de quién es la cuenta. Se espera; no se cobra. */
  | { kind: "checking" }
  /** Hace falta un nombre para poder guardar el puntaje. */
  | { kind: "needs_name" }
  /** El nombre ya está vinculado a otra dirección (casi siempre, suya). */
  | { kind: "name_taken"; owner: string | null }
  /** Jugada pagada sin registrar: se termina esa, JAMÁS se cobra otra. */
  | { kind: "resume_pending"; pending: PendingPlay }
  /** La cadena dice que pagó otra dirección. Ni se pierde ni se atribuye sola. */
  | { kind: "payer_mismatch"; txHash: string; payer?: string };

export default function GameShell() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [playerName, setPlayerName] = useState("");
  const [deckSize, setDeckSize] = useState(10);
  const [cards, setCards] = useState<VisualCard[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cardsLeft, setCardsLeft] = useState(0);
  const [errors, setErrors] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [shakeCardId, setShakeCardId] = useState<number | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [bestAverageMs, setBestAverageMs] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [payError, setPayError] = useState<MessageKey | null>(null);
  // Paso de la jugada en curso (null = no hay ninguna). Vive aquí porque lo
  // pintan tanto el lobby como los resultados.
  const [payStage, setPayStage] = useState<PlayStage | null>(null);
  // Modal contextual de acceso (correo/wallet/alias) del lobby.
  const [accessOpen, setAccessOpen] = useState(false);
  /**
   * Por qué está parado el cobro. Es distinto de `payError`: aquí no hay un
   * fallo que reintentar, hay una situación que la persona tiene que resolver
   * —reconectar, cambiar de wallet, elegir otro nombre o terminar de registrar
   * una jugada que YA pagó—. Mientras esto no sea `null`, no se cobra nada.
   */
  const [payBlock, setPayBlock] = useState<PayBlock | null>(null);

  const t = useT();
  const profile = useProfile();
  const activeWallet = useActiveWallet();
  // La wallet del perfil en sus tres estados. `loading` frena el cobro en vez
  // de dejarlo pasar, que es lo que hacía cuando esto era `string | null`.
  const canonical = useCanonicalWallet();
  const inMiniPay = useIsMiniPay();
  const { openConnectModal } = useConnectModal();
  const queryClient = useQueryClient();
  const { playForDeck, canPlay } = usePayToPlay();

  // Jugadas gratis del día según el CONTRATO (una por mazo por wallet).
  const {
    freeByDeck,
    ready: entitlementReady,
    refetch: refetchFreePlays,
  } = useFreePlays(activeWallet.address);

  // Alias local de jugadores solo-wallet (compartido con el perfil vía hook).
  const {
    walletAlias,
    ready: walletAliasReady,
    setWalletAlias,
  } = useWalletAlias();

  // Tutorial "Cómo se juega": aparece solo la primera visita y puede
  // reabrirse desde el botón del inicio. Solo vive en la fase de setup.
  const howTo = useHowToPlay();

  /**
   * Alias efectivo del jugador. Manda el de la WALLET, no el de la sesión: el
   * puntaje se guarda contra la wallet que firma, y es su nombre el que sale en
   * el ranking. Cuando ambas identidades son la misma persona con una sola
   * dirección —el caso normal— los dos valores coinciden y el orden da igual;
   * importa cuando no: sesión de correo con una wallet externa distinta.
   */
  const currentAlias = walletAlias ?? profile.alias ?? "";

  // Info on-chain de la partida en curso: toda jugada tiene su transacción.
  // Refs porque se leen dentro de timeouts.
  const txHashRef = useRef("");
  const playerRef = useRef("");

  // Estado vivo de la partida: se lee dentro de timeouts/intervalos sin
  // preocuparse por closures viejos.
  const baseRef = useRef<ChainCard | null>(null);
  const incomingRef = useRef<ChainCard | null>(null);
  const targetRef = useRef("");
  const nextIdRef = useRef(3);
  const spentRef = useRef(0);
  const errorsRef = useRef(0);
  const startAtRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    setMutedState(isMuted());
    /**
     * Si quedó una jugada pagada sin registrar (se cerró el navegador, se cayó
     * la red), se anuncia al abrir en vez de esperar a que la persona pulse
     * jugar. Es dinero suyo esperando, y además así el botón nace con el
     * candado puesto.
     */
    const left = pendingPlay();
    if (left) setPayBlock({ kind: "resume_pending", pending: left });
  }, []);

  function toggleMuted() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) unlockAudio();
  }

  // Cuenta regresiva 3, 2, 1 → jugar.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown === 0) {
      sound.go();
      startAtRef.current = performance.now();
      setElapsedMs(0);
      setPhase("playing");
      return;
    }
    sound.tick();
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Cronómetro hacia arriba: tiempo real + 1s de penalización por error.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      if (finishedRef.current) return;
      setElapsedMs(
        performance.now() -
          startAtRef.current +
          errorsRef.current * ERROR_PENALTY_MS
      );
    }, 100);
    return () => clearInterval(interval);
  }, [phase]);

  /**
   * Punto de entrada al iniciar: TODA jugada (gratis o paga) firma `play(deck)`
   * on-chain. El contrato decide si consume la gratis del día o cobra 0.10
   * USDT; con la transacción confirmada arranca la partida.
   *
   * La pantalla no cambia mientras tanto: quien llamó (lobby o resultados)
   * sigue visible y `payStage` va contando el paso en su propio botón.
   */
  async function handleStart(deck: number) {
    if (payStage) return;
    setPayError(null);
    const alias = currentAlias || playerName;

    if (!canPlay) {
      setPayError("pay.error.unavailable");
      return;
    }

    /**
     * El orden de aquí abajo es la regla entera, y no se puede reordenar:
     *
     *   wallet accesible → dirección confirmada → identidad validada →
     *   saldo → transacción
     *
     * Cada paso se apoya en el anterior. Validar el nombre contra una dirección
     * que no se ha confirmado, o cobrar con una dirección que no se validó, es
     * exactamente cómo se pierde el dinero de alguien.
     */
    setPayStage("checking");

    // 1 y 2. Wallet accesible y dirección confirmada. Falla CERRADO: si la
    //        wallet no contesta, no se cobra. Y si ya hay una jugada pagada sin
    //        registrar, esto devuelve `resume_pending` y NUNCA se cobra otra.
    // `canonical` es el paso 2b: no basta con que la wallet conteste y sea la
    // de hace un segundo, tiene que ser la DEL PERFIL. Una embebida creada por
    // accidente contesta igual de bien y no es quien cobra (`wallet-identity.ts`).
    const decision = decidePlayStart({
      expected: activeWallet.address,
      probe: await probeWallet(activeWallet.connector),
      pending: pendingPlay(),
      canonical,
    });
    if (decision.kind !== "proceed") {
      setPayStage(null);
      applyBlockedDecision(decision);
      return;
    }
    const confirmed = decision.address;

    // 3. Identidad, contra la dirección CONFIRMADA. Si el puntaje no va a poder
    //    guardarse, el jugador se entera aquí —con la plata todavía suya— y no
    //    al terminar la partida.
    const verdict = await checkAliasBeforePaying(alias, confirmed);
    if (verdict.kind !== "ok") {
      setPayStage(null);
      setPayBlock(
        verdict.kind === "needs_name"
          ? { kind: "needs_name" }
          : { kind: "name_taken", owner: verdict.owner }
      );
      return;
    }

    setDeckSize(deck);
    setPayStage("confirm");
    try {
      // 4 y 5. Saldo y firma, siempre con la dirección confirmada. `playForDeck`
      //        vuelve a comprobarla pegado a cada firma.
      const { txHash, player } = await playForDeck(deck, setPayStage, confirmed);
      txHashRef.current = txHash;
      playerRef.current = player;

      // El cobro ya ocurrió y no se deshace. Lo PRIMERO es dejar el txHash
      // escrito en el dispositivo, de forma síncrona: si Chrome se cierra en
      // el instante siguiente, el registro sale solo al volver a abrir.
      const receipt = enqueue(`play:${txHash}`, "/api/plays", {
        txHash,
        player,
        deckSize: deck,
        alias: alias || undefined,
      });

      // Y no se reparten cartas hasta que el servidor confirme que la jugada
      // quedó registrada. Se borra de la bandeja al confirmarse, dentro de
      // `deliver`.
      setPayStage("registering");
      const sent = await deliver(receipt, BLOCKING_DELAYS);
      if (sent.result !== "ok") {
        setPayStage(null);
        /**
         * A partir de aquí el dinero YA salió. Nada de lo que pase puede
         * terminar en otro cobro: el envío sigue en la bandeja, así que el
         * botón de jugar pasa a ser "terminar de registrar" (lo decide
         * `pendingPlay()` en el siguiente intento).
         */
        if (sent.error === "payer_mismatch") {
          setPayBlock({ kind: "payer_mismatch", txHash, payer: sent.payer });
        } else {
          setPayError(describeRegisterError(sent.result));
        }
        return;
      }

      // La jugada gratis de este mazo acaba de gastarse (o ya estaba gastada y
      // esta se cobró). Se vuelve a preguntar YA, no al terminar la partida:
      // así el botón de los resultados sabe decir cuánto cuesta la revancha.
      refetchFreePlays();

      setPayStage("starting");
      setTimeout(() => {
        setPayStage(null);
        startGame(alias, deck);
      }, HANDOFF_MS);
    } catch (err) {
      setPayStage(null);
      // La wallet dejó de ser la validada a mitad del cobro. No es un error de
      // pago: es el guardián haciendo su trabajo, y se cuenta como tal.
      if (err instanceof WalletChangedError) {
        applyBlockedDecision(err.decision);
        return;
      }
      setPayError(describePayError(err));
    }
  }

  /**
   * Volver a conectar, reutilizando el conector de siempre — no hay un flujo
   * paralelo. Abrir el modal es lo que le da a la extensión la ocasión de pedir
   * la contraseña; al volver, nada se da por bueno: la persona pulsa jugar y
   * TODO se revalida desde el primer paso.
   *
   * Dentro de MiniPay no se ofrece conectar (su reglamento lo prohíbe y la
   * wallet ya está puesta): ahí "reintentar" es limpiar el bloqueo y volver a
   * preguntarle a la wallet.
   */
  function reconnectWallet() {
    setPayBlock(null);
    setPayError(null);
    if (!inMiniPay) openConnectModal?.();
  }

  /** Traduce la decisión del guardián a lo que hay que enseñar en pantalla. */
  function applyBlockedDecision(decision: PayDecision) {
    setPayError(null);
    switch (decision.kind) {
      case "resume_pending":
        setPayBlock({ kind: "resume_pending", pending: decision.pending });
        return;
      case "reconnect":
        setPayBlock({ kind: "reconnect" });
        return;
      case "account_changed":
        setPayBlock({ kind: "account_changed", actual: decision.actual });
        return;
      case "wrong_wallet":
        setPayBlock({
          kind: "wrong_wallet",
          canonical: decision.canonical,
          connected: decision.connected,
        });
        return;
      case "checking":
        // Todavía no se sabe de quién es la cuenta. No es un rechazo y no deja
        // rastro: el perfil llega en un instante y el jugador vuelve a tocar.
        // Lo que NO puede pasar es que se cobre mientras tanto.
        setPayBlock({ kind: "checking" });
        return;
    }
  }

  /**
   * Reconciliación del pagador, y la hace la PERSONA, no la app.
   *
   * Cuando la cadena dice que pagó una dirección distinta, el envío se queda
   * pendiente y en pantalla sale cuál fue. Si acto seguido conecta esa misma
   * wallet, eso es su confirmación de que es suya: recién ahí se corrige el
   * envío y se reintenta. Sin ese gesto no se toca nada — corregirlo solos
   * sería inventarle dueño a una jugada.
   */
  useEffect(() => {
    if (payBlock?.kind !== "payer_mismatch") return;
    const payer = payBlock.payer?.toLowerCase();
    if (!payer || !activeWallet.address) return;
    if (activeWallet.address !== payer) return;
    repairPendingPlayer(payBlock.txHash, payer);
    void resumePendingPlay();
    // `resumePendingPlay` se redefine en cada render; se llama por su efecto,
    // no se observa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payBlock, activeWallet.address]);

  /** Reintenta el registro de una jugada ya pagada. NUNCA vuelve a cobrar. */
  async function resumePendingPlay() {
    const items = pending().filter((it) => it.id.startsWith("play:"));
    if (items.length === 0) {
      setPayBlock(null);
      return;
    }
    setPayStage("registering");
    for (const item of items) {
      const outcome = await deliver(item, BLOCKING_DELAYS);
      if (outcome.result === "ok") continue;
      setPayStage(null);
      if (outcome.error === "payer_mismatch") {
        const body = item.body as { txHash?: string };
        setPayBlock({
          kind: "payer_mismatch",
          txHash: body?.txHash ?? "",
          payer: outcome.payer,
        });
      } else {
        setPayError(describeRegisterError(outcome.result));
      }
      return;
    }
    setPayStage(null);
    setPayBlock(null);
    refetchFreePlays();
  }

  function startGame(name: string, deck: number) {
    unlockAudio();
    const base = generateFirstCard();
    const gen = generateNextCard(base, 2);
    baseRef.current = base;
    incomingRef.current = gen.card;
    targetRef.current = gen.targetSymbolId;
    nextIdRef.current = 3;
    spentRef.current = 0;
    errorsRef.current = 0;
    finishedRef.current = false;

    setPlayerName(name);
    setDeckSize(deck);
    setCardsLeft(deck);
    setCards([
      { card: base, role: "base", fresh: true },
      { card: gen.card, role: "incoming", fresh: true },
    ]);
    setElapsedMs(0);
    setErrors(0);
    setFeedback(null);
    setShakeCardId(null);
    setResult(null);
    setIsNewRecord(false);
    setCountdown(3);
    setPhase("countdown");
  }

  /**
   * Guarda la marca en la bandeja de salida y la envía al ranking de la ronda.
   * La identidad de TODA jugada es la wallet probada por el txHash de
   * `play(deck)`; el servidor lee del evento si fue gratis o paga.
   *
   * El guardado es lo primero y es síncrono: si el jugador cierra la app al
   * ver su tiempo, la marca sale sola en la siguiente apertura. `clientGameId`
   * se genera UNA vez y viaja con el envío guardado, así que reintentar (hoy o
   * mañana) siempre es la misma partida para el servidor y nunca se duplica.
   */
  function queueScore(r: GameResult): (() => Promise<void>) | null {
    if (!txHashRef.current || !playerRef.current) return null;
    const clientGameId = crypto.randomUUID();
    const item = enqueue(`score:${clientGameId}`, "/api/scores", {
      clientGameId,
      deckSize,
      totalMs: r.totalMs,
      averageMs: r.averageMs,
      errors: r.errors,
      accuracy: r.accuracy,
      txHash: txHashRef.current,
      player: playerRef.current,
      alias: currentAlias || undefined,
    });

    return async () => {
      const sent = await deliver(item, BLOCKING_DELAYS);
      if (sent.result !== "ok") return;
      // La marca ya está guardada: recarga el ranking de este mazo ANTES de
      // que el jugador vuelva al lobby. Invalidar no basta — el top no está
      // montado durante los resultados, así que quedaría marcado como viejo
      // y el jugador volvería sin verse.
      await refreshLeaderboard(queryClient, deckSize);
      refetchFreePlays();
    };
  }

  function finishGame(totalMs: number) {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const previousBest = loadLeaderboard()[0]?.averageMs ?? Infinity;
    const averageMs = Math.round(totalMs / deckSize);
    const gameResult: GameResult = {
      playerName,
      totalMs: Math.round(totalMs),
      averageMs,
      cards: deckSize,
      errors: errorsRef.current,
      accuracy: computeAccuracy(deckSize, errorsRef.current),
      createdAt: new Date().toISOString(),
    };
    // Persiste para el récord personal de este dispositivo (no es un ranking).
    saveResult(gameResult);
    // La marca queda escrita en la bandeja ANTES de pintar nada; el envío se
    // dispara después y ya puede tardar lo que quiera.
    const sendScore = queueScore(gameResult);
    setResult(gameResult);
    setBestAverageMs(Math.min(previousBest, averageMs));
    setIsNewRecord(averageMs < previousBest);
    if (averageMs < previousBest) {
      sound.record();
    } else {
      sound.finish();
    }
    setPhase("results");
    void sendScore?.();
  }

  /** Rota roles: la base vieja sale y tu carta pasa a ser la nueva base. */
  function promoteCards(newIncoming: ChainCard | null) {
    const exiting = baseRef.current!;
    const newBase = incomingRef.current!;
    baseRef.current = newBase;
    incomingRef.current = newIncoming;

    setCards((prev) => {
      const rotated = prev.map((c) =>
        c.card.id === exiting.id
          ? { ...c, role: "exiting" as Role }
          : c.card.id === newBase.id
            ? { ...c, role: "base" as Role }
            : c
      );
      return newIncoming
        ? rotated.concat({ card: newIncoming, role: "incoming", fresh: true })
        : rotated;
    });
    setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.card.id !== exiting.id));
    }, EXIT_ANIMATION_MS);
  }

  function handleTap(cardId: number, symbolId: string) {
    if (phase !== "playing" || finishedRef.current) return;
    // Solo se juega con tu carta: la base es de referencia y no responde.
    if (cardId !== incomingRef.current?.id) return;

    if (symbolId === targetRef.current) {
      spentRef.current += 1;
      const remaining = deckSize - spentRef.current;
      setCardsLeft(remaining);
      setFeedback({ cardId, symbolId, type: "good" });
      vibrate(25);
      sound.correct();
      if (remaining > 0) sound.deal(0.2);

      if (remaining === 0) {
        // Última carta gastada: el reloj se detiene aquí, la animación cierra.
        const totalMs =
          performance.now() -
          startAtRef.current +
          errorsRef.current * ERROR_PENALTY_MS;
        setElapsedMs(totalMs);
        promoteCards(null);
        setTimeout(() => finishGame(totalMs), FINAL_CARD_DELAY_MS);
      } else {
        const gen = generateNextCard(incomingRef.current, nextIdRef.current++);
        targetRef.current = gen.targetSymbolId;
        promoteCards(gen.card);
      }
      setTimeout(() => {
        setFeedback((f) =>
          f && f.cardId === cardId && f.type === "good" ? null : f
        );
      }, 250);
    } else {
      errorsRef.current += 1;
      setErrors(errorsRef.current);
      setFeedback({ cardId, symbolId, type: "bad" });
      setShakeCardId(cardId);
      vibrate([60, 40, 60]);
      sound.error();
      setTimeout(() => {
        setFeedback(null);
        setShakeCardId(null);
      }, 300);
    }
  }

  /**
   * Qué símbolo destella en cada carta: al acertar, el símbolo común brilla
   * tanto en tu carta como en la base para confirmar el match; al fallar,
   * solo el símbolo tocado.
   */
  function flashSymbolFor(vc: VisualCard): string | null {
    if (!feedback) return null;
    if (feedback.type === "bad") {
      return feedback.cardId === vc.card.id ? feedback.symbolId : null;
    }
    return vc.role !== "incoming" || feedback.cardId === vc.card.id
      ? feedback.symbolId
      : null;
  }

  const withNav = phase === "setup" || phase === "results";

  return (
    <main
      className={`shell${phase === "playing" ? " playing" : ""}${
        phase === "setup" ? " lobby" : ""
      }${withNav ? " with-nav" : ""}`}
    >
      {/* La marca vive en menús y resultados; durante la partida el HUD es
          mínimo y la barra superior desaparece. En el setup, la topbar espera
          a saber si toca tutorial o lobby para no parpadear. */}
      {phase !== "playing" && (phase !== "setup" || howTo.resolved) && (
        <header className="topbar">
          {/* Hueco simétrico al botón de sonido: el perfil vive en la barra
              inferior, no aquí. */}
          <span className="topbar-side" aria-hidden="true" />
          <h1 className="title">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-avispate.png" alt="" className="brand-icon" />
            Avíspate
          </h1>
          <button
            type="button"
            className="mute-btn"
            onClick={toggleMuted}
            aria-label={muted ? t("sound.unmute") : t("sound.mute")}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </header>
      )}

      {/* Primera pintura: hasta resolver localStorage solo se ve el fondo de
          marca. Sin "Cargando…", sin acceso y sin lobby intermedio. */}
      {phase === "setup" && !howTo.resolved && (
        <div className="lobby-boot" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-avispate.png" alt="" className="lobby-boot-logo" />
        </div>
      )}

      {phase === "setup" && howTo.resolved && howTo.open && (
        <HowToPlay onClose={howTo.close} />
      )}

      {phase === "setup" && howTo.resolved && (
        <>
          <HomeLobby
            payBlock={payBlock}
            onReconnect={reconnectWallet}
            onPickAnotherName={() => {
              setPayBlock(null);
              setAccessOpen(true);
            }}
            onResumePending={resumePendingPlay}
            deckSize={deckSize}
            onDeckChange={setDeckSize}
            freeByDeck={freeByDeck}
            entitlementReady={entitlementReady}
            walletAlias={walletAlias}
            walletAliasReady={walletAliasReady}
            payStage={payStage}
            payError={payError}
            onStart={handleStart}
            onRequestAccess={() => setAccessOpen(true)}
            onShowHowTo={howTo.replay}
          />
          {accessOpen && (
            <StartAccessModal
              walletAlias={walletAlias}
              walletAliasReady={walletAliasReady}
              onSetWalletAlias={setWalletAlias}
              onClose={() => setAccessOpen(false)}
            />
          )}
          <ProfileBottomNav active="inicio" />
        </>
      )}

      {phase === "countdown" && (
        <div className="countdown">
          <div className="countdown-badge" key={countdown}>
            {countdown}
          </div>
        </div>
      )}

      {phase === "playing" && (
        <>
          <GameHUD
            deckSize={deckSize}
            cardsLeft={cardsLeft}
            muted={muted}
            onToggleMute={toggleMuted}
          />
          <div className="play-board">
            <aside className="side-stats">
              <div className="stat-pill">
                <span className="sp-emoji">⏱️</span>
                <span className="sp-value">
                  {(elapsedMs / 1000).toFixed(1)}s
                </span>
                <span className="sp-label">{t("game.stat.time")}</span>
              </div>
            </aside>
            <div className="chain-area">
              <span className="slot-tag slot-tag-base">{t("game.slot.base")}</span>
              <span className="slot-tag slot-tag-mine">{t("game.slot.mine")}</span>
              {cardsLeft > 1 && <div className="deck-stack" />}
              {errors > 0 && (
                <span key={errors} className="penalty-float">
                  +1s
                </span>
              )}
              {cards.map((vc) => (
                <div
                  key={vc.card.id}
                  className={`chain-card slot-${vc.role}${vc.fresh ? " fresh" : ""}`}
                >
                  <CardView
                    symbols={vc.card.symbols}
                    flashSymbolId={flashSymbolFor(vc)}
                    flashType={feedback?.type ?? null}
                    shake={shakeCardId === vc.card.id}
                    disabled={vc.role !== "incoming"}
                    onTap={(symbolId) => handleTap(vc.card.id, symbolId)}
                  />
                </div>
              ))}
            </div>
            <aside className="side-stats">
              <div className="stat-pill">
                <span className="sp-emoji">🃏</span>
                <span className="sp-value">{cardsLeft}</span>
                <span className="sp-label">{t("game.stat.cards")}</span>
              </div>
              <div className="stat-pill">
                <span className="sp-emoji">💥</span>
                <span className="sp-value">{errors}</span>
                <span className="sp-label">{t("game.stat.errors")}</span>
              </div>
            </aside>
          </div>
        </>
      )}

      {phase === "results" && result && (
        <>
          <ResultsPanel
            result={result}
            bestAverageMs={bestAverageMs}
            isNewRecord={isNewRecord}
            payStage={payStage}
            nextFree={entitlementReady && freeByDeck[deckSize]}
            onPlayAgain={() => handleStart(deckSize)}
            onChangePlayer={() => setPhase("setup")}
          />
          {payError && (
            <p className="alias-error">
              {t(payError, { fee: fmtUsdt(FEE_AMOUNT) })}
            </p>
          )}
          <ProfileBottomNav active="inicio" />
        </>
      )}
    </main>
  );
}
