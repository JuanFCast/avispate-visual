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
import { usePayToPlay } from "@/lib/pay";
import { useActiveWallet } from "@/lib/wallet";
import Link from "next/link";
import { useWalletAlias } from "@/lib/wallet-alias";
import AccessCard from "./AccessCard";
import AliasGate from "./AliasGate";
import WalletAliasForm from "./WalletAliasForm";
import PlayerForm from "./PlayerForm";
import CardView from "./CardView";
import GameHUD from "./GameHUD";
import ResultsPanel from "./ResultsPanel";
import GlobalLeaderboard from "./GlobalLeaderboard";

type Phase = "setup" | "paying" | "countdown" | "playing" | "results";
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

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

/** Traduce un error del flujo de pago a un mensaje corto para el jugador. */
function describePayError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|User rejected/i.test(msg))
    return "Cancelaste el pago.";
  if (/insufficient|exceeds balance|transfer amount/i.test(msg))
    return "Saldo insuficiente de USDT (o gas) para pagar la jugada.";
  if (/pot_not_configured/.test(msg))
    return "El pago aún no está disponible (contrato no configurado).";
  if (/no_wallet/.test(msg)) return "Conecta una wallet para pagar.";
  return "No se pudo completar el pago. Inténtalo de nuevo.";
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
  // Qué mazos aún tienen la jugada gratis de hoy; el resto se paga.
  const [freeByDeck, setFreeByDeck] = useState<Record<number, boolean>>({});
  const [payError, setPayError] = useState<string | null>(null);

  const profile = useProfile();
  const activeWallet = useActiveWallet();
  const queryClient = useQueryClient();
  const { payForDeck, canPay } = usePayToPlay();

  // Alias local de jugadores solo-wallet (compartido con el perfil vía hook).
  const { walletAlias, setWalletAlias } = useWalletAlias();

  /** Alias efectivo del jugador: Privy o el local de la wallet. */
  const currentAlias = profile.alias ?? walletAlias ?? "";

  // Info de pago de la partida en curso (para enviar el puntaje por el camino
  // correcto). Refs porque se leen dentro de timeouts.
  const paidRef = useRef(false);
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

  /** Consulta al servidor qué mazos aún tienen jugada gratis hoy. */
  const refreshEntitlement = useCallback(async () => {
    try {
      const token = profile.authenticated ? await profile.getToken() : null;
      const res = await fetch("/api/entitlement", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      setFreeByDeck(data.free ?? {});
    } catch {
      // Sin info, el flujo asume pago (no regala jugadas).
    }
  }, [profile]);

  useEffect(() => {
    if (!profile.ready) return;
    refreshEntitlement();
  }, [profile.ready, profile.authenticated, profile.alias, refreshEntitlement]);

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
   * Punto de entrada al iniciar: si al jugador le queda su jugada gratis del
   * mazo, arranca directo; si no, cobra 0.10 USDT on-chain y, con el pago
   * confirmado, arranca marcando la partida como paga.
   */
  async function handleStart(deck: number) {
    setPayError(null);
    const alias = currentAlias || playerName;

    if (freeByDeck[deck]) {
      paidRef.current = false;
      txHashRef.current = "";
      playerRef.current = "";
      startGame(alias, deck);
      return;
    }

    // Jugada paga.
    if (!canPay) {
      setPayError(
        "El pago aún no está disponible (contrato no configurado o wallet sin conectar)."
      );
      return;
    }
    setDeckSize(deck);
    setPhase("paying");
    try {
      const { txHash, player } = await payForDeck(deck);
      paidRef.current = true;
      txHashRef.current = txHash;
      playerRef.current = player;
      startGame(alias, deck);
    } catch (err) {
      setPayError(describePayError(err));
      setPhase("setup");
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
   * Envía el resultado al ranking de la ronda. Camino PAGO (identidad = wallet
   * probada por el txHash) o GRATIS (identidad = Privy). Best-effort: el récord
   * local ya quedó guardado. `clientGameId` lo hace idempotente en el servidor.
   */
  async function submitScore(r: GameResult) {
    const base = {
      clientGameId: crypto.randomUUID(),
      deckSize,
      totalMs: r.totalMs,
      averageMs: r.averageMs,
      errors: r.errors,
      accuracy: r.accuracy,
    };
    try {
      let res: Response | null = null;
      if (paidRef.current) {
        // Pago: no requiere token de Privy; el tx prueba la identidad.
        res = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...base,
            mode: "paid",
            txHash: txHashRef.current,
            player: playerRef.current,
            alias: currentAlias || undefined,
          }),
        });
      } else {
        // Gratis: requiere sesión Privy con alias.
        if (!profile.authenticated || !profile.alias) return;
        const token = await profile.getToken();
        if (!token) return;
        res = await fetch("/api/scores", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...base, mode: "free" }),
        });
      }
      if (res && res.ok) {
        // Refresca el ranking de la ronda y las jugadas gratis restantes.
        queryClient.invalidateQueries({ queryKey: ["leaderboard", deckSize] });
        void refreshEntitlement();
      }
    } catch {
      // Best-effort; el récord personal ya se guardó.
    }
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
    void submitScore(gameResult);
    setResult(gameResult);
    setBestAverageMs(Math.min(previousBest, averageMs));
    setIsNewRecord(averageMs < previousBest);
    if (averageMs < previousBest) {
      sound.record();
    } else {
      sound.finish();
    }
    setPhase("results");
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

  return (
    <main className={`shell${phase === "playing" ? " playing" : ""}`}>
      {/* La marca vive en menús y resultados; durante la partida el HUD es
          mínimo y la barra superior desaparece. */}
      {phase !== "playing" && (
        <header className="topbar">
          <span className="topbar-side">
            {(profile.authenticated || activeWallet.isConnected) && (
              <Link
                href="/perfil"
                className="profile-trigger"
                aria-label="Ver tu perfil"
              >
                <span aria-hidden="true">👤</span>
                <span className="profile-trigger-name">
                  {currentAlias || "Perfil"}
                </span>
              </Link>
            )}
          </span>
          <h1 className="title">
            {/* En el inicio la avispa ya protagoniza como héroe: no se repite. */}
            {phase !== "setup" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo-avispate.png" alt="" className="brand-icon" />
            )}
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

      {phase === "setup" && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-avispate.png" alt="Avíspate" className="hero-icon" />
          <p className="subtitle">
            ¡Despierta esos ojos! Gasta tu mazo de cartas en el menor tiempo
            posible.
          </p>
          <div className="steps">
            <div className="step">
              <span className="step-emoji">👀</span>
              Encuentra el símbolo común
            </div>
            <div className="step">
              <span className="step-emoji">👆</span>
              Tócalo en tu carta
            </div>
            <div className="step">
              <span className="step-emoji">⚡</span>
              ¡Avíspate y repite!
            </div>
          </div>
          {/* Dos caminos: correo (Privy → alias → jugar, con 1 gratis diaria) o
              wallet (conectar → alias local → jugar pagando). */}
          {!profile.ready ? (
            <p className="access-note">Cargando…</p>
          ) : profile.authenticated ? (
            profile.loading ? (
              <p className="access-note">Cargando perfil…</p>
            ) : profile.alias ? (
              <PlayerForm
                onStart={handleStart}
                freeByDeck={freeByDeck}
                payError={payError}
              />
            ) : (
              <AliasGate />
            )
          ) : activeWallet.isConnected ? (
            walletAlias ? (
              <PlayerForm
                onStart={handleStart}
                freeByDeck={freeByDeck}
                payError={payError}
              />
            ) : (
              <WalletAliasForm onSet={setWalletAlias} />
            )
          ) : (
            <AccessCard />
          )}
          <div style={{ width: "100%", maxWidth: 420 }}>
            <GlobalLeaderboard initialDeck={deckSize} />
          </div>
        </>
      )}

      {phase === "paying" && (
        <div className="countdown">
          <p className="access-note">Procesando pago de 0.10 USDT…</p>
          <p className="empty-note">Confirma en tu wallet. No cierres esta ventana.</p>
        </div>
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
            onPlayAgain={() => handleStart(deckSize)}
            onChangePlayer={() => setPhase("setup")}
          />
          {payError && <p className="alias-error">{payError}</p>}
          <div style={{ width: "100%", maxWidth: 420 }}>
            <GlobalLeaderboard initialDeck={deckSize} />
          </div>
        </>
      )}
    </main>
  );
}
