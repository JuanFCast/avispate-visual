"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { arenaPrize, fmtEntry, fmtUsdt } from "@/lib/arena";
import {
  ROOM_CODE_DIGITS,
  formatRoomCodeInput,
  normalizeRoomCode,
  type RoomError,
} from "@/lib/arena-rooms";
import { useProfile } from "@/lib/profile-context";
import { useT } from "@/lib/i18n/client";
import { roomErrorText } from "@/lib/arena-room-errors";
import AccessCard from "../AccessCard";
import ArenaPlayers from "./ArenaPlayers";

type Choice = "create" | "join";

interface Props {
  /** Unidades de USDT como texto: `bigint` no cruza del servidor al cliente. */
  entry: string;
  players: number;
}

/**
 * /arena/privada — los dos caminos a una sala: armarla o entrar con el código.
 *
 * La mesa NO se elige aquí. La entrada y el número de jugadores vienen del
 * lobby en la URL y esta pantalla solo los repite antes de crear, para que el
 * anfitrión confirme lo que va a proponer sin volver atrás. Quien entra con
 * código no elige nada: acepta la mesa que armó el otro.
 *
 * Nada de esto cobra. Crear o entrar no mueve USDT ni bloquea fondos.
 */
export default function ArenaPrivate({ entry, players }: Props) {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated, getToken } = useProfile();

  const [choice, setChoice] = useState<Choice>("create");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);
  /** La sala en la que ya estaba sentado, si volvió después de irse. */
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const entryUnits = BigInt(entry);
  const prize = arenaPrize(entryUnits, players);

  // Una sala abierta a su nombre es lo primero que hay que decirle: crear otra
  // cerraría la anterior y dejaría a sus amigos esperando en una mesa muerta.
  useEffect(() => {
    if (!ready || !authenticated) {
      setActiveCode(null);
      return;
    }
    let alive = true;
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch("/api/arena/rooms/active", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (alive && res.ok) setActiveCode(data?.code ?? null);
      } catch {
        // Sin respuesta no se inventa una sala: simplemente no se ofrece volver.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, authenticated, getToken]);

  const post = useCallback(
    async (path: string, body: unknown): Promise<string | null> => {
      const token = await getToken();
      if (!token) {
        setError("unauthorized");
        return null;
      }
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as RoomError) ?? "server_error");
        return null;
      }
      return (data?.code as string) ?? null;
    },
    [getToken]
  );

  async function create() {
    setError(null);
    setBusy(true);
    const created = await post("/api/arena/rooms", {
      entry: entryUnits.toString(),
      players,
    });
    if (created) router.push(`/arena/sala/${created}`);
    else setBusy(false);
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setError("invalid_code");
      return;
    }
    setBusy(true);
    const joined = await post("/api/arena/rooms/join", { code: normalized });
    if (joined) router.push(`/arena/sala/${joined}`);
    else setBusy(false);
  }

  return (
    <>
      <header className="arena-lobby-head">
        <span className="arena-tag">{t("room.tag")}</span>
        <h1 className="page-title">{t("arena.mode.private.title")}</h1>
        <p className="page-lead">{t("room.lead")}</p>
      </header>

      <div className="arena-art arena-lobby-art">
        <ArenaPlayers />
      </div>

      {activeCode && (
        <section className="arena-card room-resume">
          <div className="room-resume-body">
            <strong>{t("room.resume.title")}</strong>
            <small>{t("room.resume.text", { code: activeCode })}</small>
          </div>
          <Link className="room-resume-cta" href={`/arena/sala/${activeCode}`}>
            {t("room.resume.cta")}
          </Link>
        </section>
      )}

      <section
        className="arena-modes"
        role="radiogroup"
        aria-label={t("room.choice.aria")}
      >
        {(
          [
            { id: "create", emoji: "✨" },
            { id: "join", emoji: "🔑" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={opt.id === choice}
            className={`arena-mode${opt.id === choice ? " selected" : ""}`}
            onClick={() => {
              setChoice(opt.id);
              setError(null);
            }}
          >
            <span className="arena-mode-emoji" aria-hidden="true">
              {opt.emoji}
            </span>
            <span className="arena-mode-body">
              <span className="arena-mode-title">
                {t(opt.id === "create" ? "room.option.create" : "room.option.join")}
              </span>
              <small className="arena-mode-text">
                {t(
                  opt.id === "create"
                    ? "room.option.create.text"
                    : "room.option.join.text"
                )}
              </small>
            </span>
            <span className="arena-mode-check" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </section>

      {ready && !authenticated ? (
        <section className="arena-card room-login">
          <h2 className="arena-hero-title">{t("room.login.title")}</h2>
          <p className="arena-hero-text">{t("room.login.text")}</p>
          <AccessCard />
        </section>
      ) : choice === "create" ? (
        <section className="arena-card arena-setup" aria-label={t("arena.setup.aria")}>
          <dl className="arena-recap">
            <div className="arena-recap-item">
              <dt>{t("arena.entry.label")}</dt>
              <dd>{fmtEntry(entryUnits)} USDT</dd>
            </div>
            <div className="arena-recap-item">
              <dt>{t("room.config.max")}</dt>
              <dd>
                {players} {t("arena.players.unit")}
              </dd>
            </div>
            <div className="arena-recap-item">
              <dt>{t("arena.prize.pot")}</dt>
              <dd>{fmtUsdt(prize.potUnits)} USDT</dd>
            </div>
            <div className="arena-recap-item arena-recap-win">
              <dt>{t("arena.prize.winner")}</dt>
              <dd>{fmtUsdt(prize.winnerUnits)} USDT</dd>
            </div>
          </dl>

          <p className="arena-prize-note">{t("room.create.note")}</p>

          {error && <p className="room-error">{roomErrorText(t, error)}</p>}

          <button
            type="button"
            className="btn-primary"
            onClick={create}
            disabled={busy || !ready}
          >
            {busy ? t("room.create.creating") : t("room.create.cta")}
          </button>

          <Link className="lobby-ranking-link" href="/arena">
            {t("arena.soon.back_lobby")}
          </Link>
        </section>
      ) : (
        <form
          className="arena-card arena-setup"
          onSubmit={join}
          aria-label={t("room.option.join")}
        >
          <div className="field">
            <label htmlFor="room-code">{t("room.join.label")}</label>
            <input
              id="room-code"
              className="room-code-input"
              value={code}
              onChange={(e) => {
                setCode(formatRoomCodeInput(e.target.value));
                setError(null);
              }}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              placeholder={`AVP-${"0".repeat(ROOM_CODE_DIGITS)}`}
              aria-describedby="room-code-hint"
            />
          </div>

          <p id="room-code-hint" className="arena-prize-note">
            {t("room.join.hint")}
          </p>

          {error && <p className="room-error">{roomErrorText(t, error)}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !ready || !normalizeRoomCode(code)}
          >
            {busy ? t("room.join.joining") : t("room.join.cta")}
          </button>

          <Link className="lobby-ranking-link" href="/arena">
            {t("arena.soon.back_lobby")}
          </Link>
        </form>
      )}
    </>
  );
}
