"use client";

import { useEffect, useRef, useState } from "react";
import {
  computeAccuracy,
  generateFirstCard,
  generateNextCard,
  COMBO_BONUS,
  ERROR_POINTS,
  POINTS_CORRECT,
  type ChainCard,
  type GameResult,
} from "@/lib/game";
import { loadLeaderboard, saveResult } from "@/lib/leaderboard";
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

const EXIT_ANIMATION_MS = 450;

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export default function GameShell() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [playerName, setPlayerName] = useState("");
  const [durationS, setDurationS] = useState(60);
  const [cards, setCards] = useState<VisualCard[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [errors, setErrors] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [shakeCardId, setShakeCardId] = useState<number | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [position, setPosition] = useState(-1);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<GameResult[]>([]);

  // Estado vivo de la partida: se lee dentro de timeouts/intervalos sin
  // preocuparse por closures viejos.
  const baseRef = useRef<ChainCard | null>(null);
  const incomingRef = useRef<ChainCard | null>(null);
  const targetRef = useRef("");
  const nextIdRef = useRef(3);
  const scoreRef = useRef(0);
  const correctRef = useRef(0);
  const errorsRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const endAtRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    setLeaderboard(loadLeaderboard());
  }, []);

  // Cuenta regresiva 3, 2, 1 → jugar.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown === 0) {
      endAtRef.current = performance.now() + durationS * 1000;
      setTimeLeftMs(durationS * 1000);
      setPhase("playing");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown, durationS]);

  // Reloj de la partida: al llegar a cero se termina el juego.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      const left = endAtRef.current - performance.now();
      if (left <= 0) {
        setTimeLeftMs(0);
        finishGame();
      } else {
        setTimeLeftMs(left);
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function startGame(name: string, duration: number) {
    const base = generateFirstCard();
    const gen = generateNextCard(base, 2);
    baseRef.current = base;
    incomingRef.current = gen.card;
    targetRef.current = gen.targetSymbolId;
    nextIdRef.current = 3;
    scoreRef.current = 0;
    correctRef.current = 0;
    errorsRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    finishedRef.current = false;

    setPlayerName(name);
    setDurationS(duration);
    setCards([
      { card: base, role: "base", fresh: true },
      { card: gen.card, role: "incoming", fresh: true },
    ]);
    setScore(0);
    setCombo(0);
    setErrors(0);
    setFeedback(null);
    setShakeCardId(null);
    setResult(null);
    setPosition(-1);
    setIsNewRecord(false);
    setCountdown(3);
    setPhase("countdown");
  }

  function finishGame() {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const previousBest = loadLeaderboard()[0]?.score ?? 0;
    const gameResult: GameResult = {
      playerName,
      score: scoreRef.current,
      correct: correctRef.current,
      errors: errorsRef.current,
      accuracy: computeAccuracy(correctRef.current, errorsRef.current),
      maxCombo: maxComboRef.current,
      durationS,
      createdAt: new Date().toISOString(),
    };
    const saved = saveResult(gameResult);
    setResult(gameResult);
    setPosition(saved.position);
    setLeaderboard(saved.leaderboard);
    setBestScore(Math.max(previousBest, gameResult.score));
    setIsNewRecord(gameResult.score > previousBest && gameResult.score > 0);
    setPhase("results");
  }

  /**
   * Avanza la cadena: la carta base sale, la entrante pasa a ser la nueva base
   * y se reparte una carta nueva. Los cambios de rol animan por CSS.
   */
  function advanceChain() {
    const exiting = baseRef.current!;
    const newBase = incomingRef.current!;
    const gen = generateNextCard(newBase, nextIdRef.current++);
    baseRef.current = newBase;
    incomingRef.current = gen.card;
    targetRef.current = gen.targetSymbolId;

    setCards((prev) =>
      prev
        .map((c) =>
          c.card.id === exiting.id
            ? { ...c, role: "exiting" as Role }
            : c.card.id === newBase.id
              ? { ...c, role: "base" as Role }
              : c
        )
        .concat({ card: gen.card, role: "incoming", fresh: true })
    );
    setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.card.id !== exiting.id));
    }, EXIT_ANIMATION_MS);
  }

  function handleTap(cardId: number, symbolId: string) {
    if (phase !== "playing" || finishedRef.current) return;

    if (symbolId === targetRef.current) {
      comboRef.current += 1;
      maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
      correctRef.current += 1;
      scoreRef.current +=
        POINTS_CORRECT + (comboRef.current - 1) * COMBO_BONUS;
      setScore(scoreRef.current);
      setCombo(comboRef.current);
      setFeedback({ cardId, symbolId, type: "good" });
      vibrate(25);
      advanceChain();
      setTimeout(() => {
        setFeedback((f) =>
          f && f.cardId === cardId && f.type === "good" ? null : f
        );
      }, 250);
    } else {
      errorsRef.current += 1;
      comboRef.current = 0;
      scoreRef.current = Math.max(0, scoreRef.current - ERROR_POINTS);
      setErrors(errorsRef.current);
      setCombo(0);
      setScore(scoreRef.current);
      setFeedback({ cardId, symbolId, type: "bad" });
      setShakeCardId(cardId);
      vibrate([60, 40, 60]);
      setTimeout(() => {
        setFeedback(null);
        setShakeCardId(null);
      }, 300);
    }
  }

  return (
    <main className="shell">
      <h1 className="title">
        Avíspate <span>Visual</span> ⚡
      </h1>

      {phase === "setup" && (
        <>
          <p className="subtitle">
            Las cartas fluyen una tras otra: encuentra el símbolo común, tócalo
            y sigue avanzando antes de que se acabe el tiempo.
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
            timeLeftMs={timeLeftMs}
            score={score}
            combo={combo}
            errors={errors}
          />
          <div className="chain-area">
            {cards.map((vc) => (
              <div
                key={vc.card.id}
                className={`chain-card slot-${vc.role}${vc.fresh ? " fresh" : ""}`}
              >
                <CardView
                  symbols={vc.card.symbols}
                  flashSymbolId={
                    feedback?.cardId === vc.card.id ? feedback.symbolId : null
                  }
                  flashType={
                    feedback?.cardId === vc.card.id ? feedback.type : null
                  }
                  shake={shakeCardId === vc.card.id}
                  disabled={vc.role === "exiting"}
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
            bestScore={bestScore}
            isNewRecord={isNewRecord}
            onPlayAgain={() => startGame(playerName, durationS)}
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
