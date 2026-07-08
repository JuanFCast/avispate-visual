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
import PlayerForm from "./PlayerForm";
import CardView from "./CardView";
import GameHUD from "./GameHUD";
import ResultsPanel from "./ResultsPanel";
import LocalLeaderboard from "./LocalLeaderboard";

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
  const [position, setPosition] = useState(-1);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [bestAverageMs, setBestAverageMs] = useState(0);
  const [leaderboard, setLeaderboard] = useState<GameResult[]>([]);
  const [muted, setMutedState] = useState(false);

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
    setLeaderboard(loadLeaderboard());
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
    setPosition(-1);
    setIsNewRecord(false);
    setCountdown(3);
    setPhase("countdown");
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
    const saved = saveResult(gameResult);
    setResult(gameResult);
    setPosition(saved.position);
    setLeaderboard(saved.leaderboard);
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
      <button
        type="button"
        className="mute-btn"
        onClick={toggleMuted}
        aria-label={muted ? "Activar sonido" : "Silenciar"}
      >
        {muted ? "🔇" : "🔊"}
      </button>
      <h1 className="title">
        Avíspate <span>Visual</span> ⚡
      </h1>

      {phase === "setup" && (
        <>
          <p className="subtitle">
            Gasta tu mazo en el menor tiempo posible: encuentra en tu carta el
            símbolo que comparte con la base y tócalo.
          </p>
          <PlayerForm initialName={playerName} onStart={startGame} />
          <div style={{ width: "100%", maxWidth: 420 }}>
            <LocalLeaderboard entries={leaderboard} />
          </div>
        </>
      )}

      {phase === "countdown" && (
        <div className="countdown" key={countdown}>
          {countdown}
        </div>
      )}

      {phase === "playing" && (
        <>
          <GameHUD
            elapsedMs={elapsedMs}
            cardsLeft={cardsLeft}
            deckSize={deckSize}
            errors={errors}
          />
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
        </>
      )}

      {phase === "results" && result && (
        <>
          <ResultsPanel
            result={result}
            position={position}
            bestAverageMs={bestAverageMs}
            isNewRecord={isNewRecord}
            onPlayAgain={() => startGame(playerName, deckSize)}
            onChangePlayer={() => setPhase("setup")}
          />
          <div style={{ width: "100%", maxWidth: 420 }}>
            <LocalLeaderboard
              entries={leaderboard}
              highlightPosition={position}
            />
          </div>
        </>
      )}
    </main>
  );
}
