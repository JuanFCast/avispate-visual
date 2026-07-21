"use client";

import { useEffect, useRef, useState } from "react";
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
import AuthBar from "./AuthBar";
import AccessCard from "./AccessCard";
import AliasGate from "./AliasGate";
import PlayerForm from "./PlayerForm";
import CardView from "./CardView";
import GameHUD from "./GameHUD";
import ResultsPanel from "./ResultsPanel";
import GlobalLeaderboard from "./GlobalLeaderboard";

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

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
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
  const [globalRefresh, setGlobalRefresh] = useState(0);

  const profile = useProfile();

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
   * Envía el resultado al ranking global (best-effort). Solo si hay sesión con
   * alias; si falla, no pasa nada (el récord personal ya quedó guardado). El
   * `clientGameId` hace el envío idempotente en el servidor.
   */
  async function submitScore(r: GameResult) {
    if (!profile.authenticated || !profile.alias) return;
    try {
      const token = await profile.getToken();
      if (!token) return;
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientGameId: crypto.randomUUID(),
          deckSize,
          totalMs: r.totalMs,
          averageMs: r.averageMs,
          errors: r.errors,
          accuracy: r.accuracy,
        }),
      });
      if (res.ok) setGlobalRefresh((n) => n + 1);
    } catch {
      // El ranking global es best-effort; el récord personal ya se guardó.
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
          <span className="topbar-side" aria-hidden="true" />
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
          <AuthBar />
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
          {/* Acceso obligatorio: correo con Privy → alias → jugar. Sin sesión
              o sin alias no se llega al formulario de partida. */}
          {!profile.ready ? (
            <p className="access-note">Cargando…</p>
          ) : !profile.authenticated ? (
            <AccessCard />
          ) : profile.loading ? (
            <p className="access-note">Cargando perfil…</p>
          ) : profile.alias ? (
            <PlayerForm onStart={(deck) => startGame(profile.alias ?? "", deck)} />
          ) : (
            <AliasGate />
          )}
          <div style={{ width: "100%", maxWidth: 420 }}>
            <GlobalLeaderboard initialDeck={deckSize} refreshKey={globalRefresh} />
          </div>
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
            onPlayAgain={() => startGame(profile.alias ?? playerName, deckSize)}
            onChangePlayer={() => setPhase("setup")}
          />
          <div style={{ width: "100%", maxWidth: 420 }}>
            <GlobalLeaderboard initialDeck={deckSize} refreshKey={globalRefresh} />
          </div>
        </>
      )}
    </main>
  );
}
