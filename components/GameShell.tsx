"use client";

import { useEffect, useRef, useState } from "react";
import {
  computeScore,
  generateRounds,
  ERROR_PENALTY_MS,
  POINTS_CORRECT,
  POINTS_ERROR,
  type GameResult,
  type Round,
} from "@/lib/game";
import { loadLeaderboard, saveResult } from "@/lib/leaderboard";
import PlayerForm from "./PlayerForm";
import CardView from "./CardView";
import GameHUD from "./GameHUD";
import ResultsPanel from "./ResultsPanel";
import LocalLeaderboard from "./LocalLeaderboard";

type Phase = "setup" | "countdown" | "playing" | "results";

interface Feedback {
  card: "A" | "B";
  symbolId: string;
  type: "good" | "bad";
}

const ADVANCE_DELAY_MS = 280;

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export default function GameShell() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [playerName, setPlayerName] = useState("");
  const [totalRounds, setTotalRounds] = useState(10);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [errors, setErrors] = useState(0);
  const [points, setPoints] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [shakeCard, setShakeCard] = useState<"A" | "B" | null>(null);
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState<GameResult | null>(null);
  const [position, setPosition] = useState(-1);
  const [leaderboard, setLeaderboard] = useState<GameResult[]>([]);

  // Acumuladores de la partida en curso (no necesitan re-render por sí mismos).
  const roundStartRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const errorsRef = useRef(0);
  const streakRef = useRef(0);
  const maxStreakRef = useRef(0);

  useEffect(() => {
    setLeaderboard(loadLeaderboard());
  }, []);

  // Cuenta regresiva 3, 2, 1 → jugar.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown === 0) {
      roundStartRef.current = performance.now();
      setPhase("playing");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Cronómetro visible (tiempo real acumulado + ronda actual + penalizaciones).
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      const current = answered ? 0 : performance.now() - roundStartRef.current;
      setElapsedMs(
        accumulatedMsRef.current +
          current +
          errorsRef.current * ERROR_PENALTY_MS
      );
    }, 100);
    return () => clearInterval(interval);
  }, [phase, answered]);

  function startGame(name: string, roundsCount: number) {
    setPlayerName(name);
    setTotalRounds(roundsCount);
    setRounds(generateRounds(roundsCount));
    setRoundIndex(0);
    setErrors(0);
    setPoints(0);
    setElapsedMs(0);
    setFeedback(null);
    setShakeCard(null);
    setAnswered(false);
    setResult(null);
    setPosition(-1);
    accumulatedMsRef.current = 0;
    errorsRef.current = 0;
    streakRef.current = 0;
    maxStreakRef.current = 0;
    setCountdown(3);
    setPhase("countdown");
  }

  function finishGame() {
    const totalMs =
      accumulatedMsRef.current + errorsRef.current * ERROR_PENALTY_MS;
    const gameResult: GameResult = {
      playerName,
      score: computeScore(
        totalMs,
        totalRounds,
        errorsRef.current,
        maxStreakRef.current
      ),
      totalMs: Math.round(totalMs),
      averageMs: Math.round(totalMs / totalRounds),
      correct: totalRounds,
      errors: errorsRef.current,
      maxStreak: maxStreakRef.current,
      createdAt: new Date().toISOString(),
    };
    const saved = saveResult(gameResult);
    setResult(gameResult);
    setPosition(saved.position);
    setLeaderboard(saved.leaderboard);
    setPhase("results");
  }

  function handleTap(card: "A" | "B", symbolId: string) {
    if (answered || phase !== "playing") return;
    const round = rounds[roundIndex];

    if (symbolId === round.targetSymbolId) {
      accumulatedMsRef.current += performance.now() - roundStartRef.current;
      streakRef.current += 1;
      maxStreakRef.current = Math.max(maxStreakRef.current, streakRef.current);
      setAnswered(true);
      setPoints((p) => p + POINTS_CORRECT);
      setFeedback({ card, symbolId, type: "good" });
      vibrate(30);

      setTimeout(() => {
        setFeedback(null);
        if (roundIndex + 1 >= totalRounds) {
          finishGame();
        } else {
          setRoundIndex((i) => i + 1);
          setAnswered(false);
          roundStartRef.current = performance.now();
        }
      }, ADVANCE_DELAY_MS);
    } else {
      errorsRef.current += 1;
      streakRef.current = 0;
      setErrors(errorsRef.current);
      setPoints((p) => p + POINTS_ERROR);
      setFeedback({ card, symbolId, type: "bad" });
      setShakeCard(card);
      vibrate([60, 40, 60]);
      setTimeout(() => {
        setFeedback(null);
        setShakeCard(null);
      }, 350);
    }
  }

  const round = rounds[roundIndex];

  return (
    <main className="shell">
      <h1 className="title">
        Avíspate <span>Visual</span> ⚡
      </h1>

      {phase === "setup" && (
        <>
          <p className="subtitle">
            Encuentra el símbolo común entre las dos cartas antes que nadie.
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

      {phase === "playing" && round && (
        <>
          <GameHUD
            round={roundIndex + 1}
            totalRounds={totalRounds}
            elapsedMs={elapsedMs}
            errors={errors}
            points={points}
          />
          <div className="cards-area">
            <CardView
              symbols={round.cardA}
              flashSymbolId={feedback?.card === "A" ? feedback.symbolId : null}
              flashType={feedback?.card === "A" ? feedback.type : null}
              shake={shakeCard === "A"}
              disabled={answered}
              onTap={(id) => handleTap("A", id)}
            />
            <CardView
              symbols={round.cardB}
              flashSymbolId={feedback?.card === "B" ? feedback.symbolId : null}
              flashType={feedback?.card === "B" ? feedback.type : null}
              shake={shakeCard === "B"}
              disabled={answered}
              onTap={(id) => handleTap("B", id)}
            />
          </div>
        </>
      )}

      {phase === "results" && result && (
        <>
          <ResultsPanel
            result={result}
            position={position}
            onPlayAgain={() => startGame(playerName, totalRounds)}
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
