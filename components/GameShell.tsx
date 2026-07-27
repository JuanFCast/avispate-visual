"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { usePayToPlay, type PlayStage } from "@/lib/pay";
import { refreshLeaderboard, useFreePlays } from "@/lib/round";
import { BLOCKING_DELAYS, deliver, enqueue } from "@/lib/outbox";
import { useActiveWallet } from "@/lib/wallet";
import { useWalletAlias } from "@/lib/wallet-alias";
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

/** Traduce un error del flujo de jugada a un mensaje corto para el jugador. */
function describePayError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|User rejected/i.test(msg))
    return "Cancelaste la firma de la jugada.";
  if (/insufficient|exceeds balance|transfer amount/i.test(msg))
    return "Saldo insuficiente de USDT (o gas) para esta jugada.";
  if (/pot_not_configured/.test(msg))
    return "El juego aún no está disponible (contrato no configurado).";
  if (/no_wallet/.test(msg)) return "Conecta una wallet o entra con tu correo.";
  return "No se pudo registrar la jugada. Inténtalo de nuevo.";
}

/**
 * La jugada se pagó pero el servidor no la confirmó. Lo importante que hay que
 * decirle al jugador es que NO vuelva a pagar: su jugada quedó guardada en el
 * teléfono y se registra sola en cuanto haya conexión.
 */
function describeRegisterError(result: "rejected" | "retry"): string {
  if (result === "retry") {
    return "Tu pago quedó confirmado, pero no pudimos avisarle al servidor. Quedó guardado en este dispositivo y se enviará solo: revisa tu conexión y vuelve a abrir la app. No vuelvas a pagar.";
  }
  return "El servidor no aceptó esta jugada. Escríbenos a soporte@avispate.fun con la hora y tu wallet y lo revisamos.";
}

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
  const [payError, setPayError] = useState<string | null>(null);
  // Paso de la jugada en curso (null = no hay ninguna). Vive aquí porque lo
  // pintan tanto el lobby como los resultados.
  const [payStage, setPayStage] = useState<PlayStage | null>(null);
  // Modal contextual de acceso (correo/wallet/alias) del lobby.
  const [accessOpen, setAccessOpen] = useState(false);

  const profile = useProfile();
  const activeWallet = useActiveWallet();
  const queryClient = useQueryClient();
  const { playForDeck, canPlay } = usePayToPlay();

  // Jugadas gratis del día según el CONTRATO (una por mazo por wallet).
  const {
    freeByDeck,
    ready: entitlementReady,
    refetch: refetchFreePlays,
  } = useFreePlays(activeWallet.address);

  // Alias local de jugadores solo-wallet (compartido con el perfil vía hook).
  const { walletAlias, setWalletAlias } = useWalletAlias();

  // Tutorial "Cómo se juega": aparece solo la primera visita y puede
  // reabrirse desde el botón del inicio. Solo vive en la fase de setup.
  const howTo = useHowToPlay();

  /** Alias efectivo del jugador: Privy o el local de la wallet. */
  const currentAlias = profile.alias ?? walletAlias ?? "";

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
      setPayError(
        "El juego aún no está disponible (contrato no configurado o wallet sin conectar)."
      );
      return;
    }
    setDeckSize(deck);
    setPayStage("confirm");
    try {
      const { txHash, player } = await playForDeck(deck, setPayStage);
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
      if (sent !== "ok") {
        setPayError(describeRegisterError(sent));
        setPayStage(null);
        return;
      }

      setPayStage("starting");
      setTimeout(() => {
        setPayStage(null);
        startGame(alias, deck);
      }, HANDOFF_MS);
    } catch (err) {
      setPayError(describePayError(err));
      setPayStage(null);
    }
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
      if (sent !== "ok") return;
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
            aria-label={muted ? "Activar sonido" : "Silenciar"}
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
            deckSize={deckSize}
            onDeckChange={setDeckSize}
            freeByDeck={freeByDeck}
            entitlementReady={entitlementReady}
            walletAlias={walletAlias}
            payStage={payStage}
            payError={payError}
            onStart={handleStart}
            onRequestAccess={() => setAccessOpen(true)}
            onShowHowTo={howTo.replay}
          />
          {accessOpen && (
            <StartAccessModal
              walletAlias={walletAlias}
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
                <span className="sp-label">tiempo</span>
              </div>
            </aside>
            <div className="chain-area">
              <span className="slot-tag slot-tag-base">Base</span>
              <span className="slot-tag slot-tag-mine">Tu carta</span>
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
                <span className="sp-label">cartas</span>
              </div>
              <div className="stat-pill">
                <span className="sp-emoji">💥</span>
                <span className="sp-value">{errors}</span>
                <span className="sp-label">errores</span>
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
            onPlayAgain={() => handleStart(deckSize)}
            onChangePlayer={() => setPhase("setup")}
          />
          {payError && <p className="alias-error">{payError}</p>}
          <ProfileBottomNav active="inicio" />
        </>
      )}
    </main>
  );
}
