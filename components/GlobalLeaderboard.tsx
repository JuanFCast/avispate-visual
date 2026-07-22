"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import { celo } from "viem/chains";
import { DECK_OPTIONS, formatMs } from "@/lib/game";
import { shortAddress, useActiveWallet } from "@/lib/wallet";
import { useProfile } from "@/lib/profile-context";
import {
  AVISPATE_POT_ADDRESS,
  AVISPATE_POT_ABI,
  USDT_DECIMALS,
} from "@/lib/contracts";

interface Entry {
  alias: string;
  walletAddress: string | null;
  averageMs: number;
  errors: number;
  totalMs: number;
}

interface Props {
  /** Mazo con el que abre; el usuario puede cambiar de pestaña. */
  initialDeck?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function fmtUsdt(units: bigint | undefined): string {
  if (units === undefined) return "…";
  return (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
}

/** Cuenta regresiva al cierre de la ronda: próximas 00:00 UTC = 7pm Colombia. */
function useCountdown(): string {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0
      );
      let s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
      const h = Math.floor(s / 3600);
      s %= 3600;
      const m = Math.floor(s / 60);
      setLeft(`${h}h ${String(m).padStart(2, "0")}m`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return left;
}

async function fetchLeaderboard(deck: number): Promise<Entry[]> {
  const res = await fetch(`/api/leaderboard?deck=${deck}`);
  if (!res.ok) throw new Error("leaderboard_fetch_failed");
  const data = await res.json();
  return data.leaderboard ?? [];
}

export default function GlobalLeaderboard({ initialDeck = 10 }: Props) {
  const [deck, setDeck] = useState(initialDeck);
  useEffect(() => {
    setDeck(initialDeck);
  }, [initialDeck]);

  const { alias } = useProfile();
  const { address } = useActiveWallet();
  const me = (address || "").toLowerCase();
  const countdown = useCountdown();
  const potEnabled = Boolean(AVISPATE_POT_ADDRESS);

  const { data: entries = [], status } = useQuery({
    queryKey: ["leaderboard", deck],
    queryFn: () => fetchLeaderboard(deck),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const { data: potUnits } = useReadContract({
    address: AVISPATE_POT_ADDRESS as `0x${string}`,
    abi: AVISPATE_POT_ABI,
    functionName: "pot",
    args: [deck],
    chainId: celo.id,
    query: { enabled: potEnabled, refetchInterval: 15_000 },
  });

  function isMe(entry: Entry): boolean {
    if (me && entry.walletAddress && entry.walletAddress.toLowerCase() === me)
      return true;
    return Boolean(alias && entry.alias === alias);
  }

  return (
    <div className="panel">
      <div className="rounds-options lb-tabs" role="tablist" aria-label="Tamaño de mazo">
        {DECK_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === deck}
            className={option === deck ? "selected" : ""}
            onClick={() => setDeck(option)}
          >
            {option} cartas
          </button>
        ))}
      </div>

      {potEnabled && (
        <div className="pot-banner">
          <span className="pot-label">🏆 Premio de hoy · el #1 se lo lleva todo</span>
          <span className="pot-amount">{fmtUsdt(potUnits as bigint | undefined)} USDT</span>
          <span className="pot-timer">⏳ cierra en {countdown} · 7pm (Col)</span>
        </div>
      )}

      <h2 className="lb-title">Ranking de hoy · mazo {deck}</h2>
      {status === "pending" && <p className="empty-note">Cargando ranking…</p>}
      {status === "error" && (
        <p className="empty-note">No se pudo cargar el ranking.</p>
      )}
      {status === "success" && entries.length === 0 && (
        <p className="empty-note">Aún no hay marcas hoy. ¡Sé el primero y gana el pozo!</p>
      )}
      {status === "success" && entries.length > 0 && (
        <ol className="lb-list">
          {entries.map((entry, i) => {
            const classes = ["lb-row"];
            if (i < 3) classes.push(`top-${i + 1}`);
            if (isMe(entry)) classes.push("me");
            return (
              <li key={`${entry.alias}-${i}`} className={classes.join(" ")}>
                <span className="lb-rank">{MEDALS[i] ?? i + 1}</span>
                <span className="lb-name">
                  <span>
                    {entry.alias}
                    {isMe(entry) && <span className="lb-you">TÚ</span>}
                  </span>
                  <small>
                    {entry.walletAddress
                      ? shortAddress(entry.walletAddress)
                      : "sin wallet"}{" "}
                    · {entry.errors} err
                  </small>
                </span>
                <span className="lb-time">
                  {formatMs(entry.averageMs)}
                  <small>{formatMs(entry.totalMs)} total</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
