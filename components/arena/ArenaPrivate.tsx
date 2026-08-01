"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ARENA_ENTRY_UNITS,
  ARENA_PLAYER_OPTIONS,
  arenaPrize,
  fmtEntry,
  fmtUsdt,
} from "@/lib/arena";
import {
  ROOM_CODE_DIGITS,
  formatRoomCodeInput,
  normalizeRoomCode,
  roomIsFull,
  type RoomError,
  type RoomView,
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
 * /arena/privada — dos recorridos que NO comparten configuración.
 *
 * Esa era la mentira que había que quitar: el lobby deja elegir entrada y
 * jugadores, y el invitado llegaba aquí con "1 USDT, 2 jugadores" en la cabeza,
 * escribía un código y aterrizaba en una mesa de 0,10. El servidor hacía lo
 * correcto —en una sala privada manda el anfitrión— pero la pantalla le había
 * hecho creer que su elección contaba.
 *
 * Ahora:
 *   · CREAR enseña los selectores de verdad, editables. Es tu mesa, la propones
 *     tú, y puedes cambiarla aquí mismo antes de repartir el código.
 *   · UNIRSE no enseña ningún selector. Lo que traías del lobby se ignora por
 *     completo, y antes de sentarte se te muestra la mesa REAL del anfitrión
 *     para que aceptes esa y no otra.
 *
 * La silla no se reserva hasta que confirmas: mirar una sala y entrar a ella
 * son dos actos distintos.
 */
export default function ArenaPrivate({ entry, players }: Props) {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated, getToken } = useProfile();

  const [choice, setChoice] = useState<Choice>("create");

  // Lo que trae el lobby es el punto de partida de la mesa que vas a proponer,
  // no una decisión cerrada.
  const [entryUnits, setEntryUnits] = useState<bigint>(BigInt(entry));
  const [maxPlayers, setMaxPlayers] = useState<number>(players);

  const [code, setCode] = useState("");
  /** La sala que se está mirando antes de decidir. Null = todavía en el código. */
  const [preview, setPreview] = useState<RoomView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const prize = arenaPrize(entryUnits, maxPlayers);

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

  function pick(next: Choice) {
    setChoice(next);
    setError(null);
    setPreview(null);
  }

  /**
   * Paso 1 de unirse: MIRAR. Lee el estado público de la sala sin token y sin
   * tocar nada — nadie ocupa una silla por escribir un código.
   */
  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setError("invalid_code");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/arena/rooms/${normalized}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as RoomError) ?? "server_error");
        return;
      }
      const room = data as RoomView;
      if (room.status === "closed") {
        setError("room_closed");
        return;
      }
      setPreview(room);
    } catch {
      setError("server_error");
    } finally {
      setBusy(false);
    }
  }

  /** Paso 2 de unirse: ACEPTAR. Recién aquí se reserva la silla. */
  async function confirmJoin() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    const token = await getToken();
    if (!token) {
      setError("unauthorized");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/arena/rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: preview.code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as RoomError) ?? "server_error");
        setBusy(false);
        return;
      }
      router.push(`/arena/sala/${data.code}`);
    } catch {
      setError("server_error");
      setBusy(false);
    }
  }

  async function create() {
    setError(null);
    setBusy(true);
    const token = await getToken();
    if (!token) {
      setError("unauthorized");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/arena/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entry: entryUnits.toString(),
          players: maxPlayers,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error as RoomError) ?? "server_error");
        setBusy(false);
        return;
      }
      router.push(`/arena/sala/${data.code}`);
    } catch {
      setError("server_error");
      setBusy(false);
    }
  }

  const needsAccess = ready && !authenticated;

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
            onClick={() => pick(opt.id)}
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

      {needsAccess ? (
        <section className="arena-card room-login">
          <h2 className="arena-hero-title">{t("room.login.title")}</h2>
          <p className="arena-hero-text">{t("room.login.text")}</p>
          <AccessCard />
        </section>
      ) : choice === "create" ? (
        /* ---- CREAR: tu mesa, con los selectores a la vista ---- */
        <section className="arena-card arena-setup" aria-label={t("arena.setup.aria")}>
          <div className="field">
            <label id="room-entry-label">{t("arena.entry.label")}</label>
            <div
              className="rounds-options"
              role="radiogroup"
              aria-labelledby="room-entry-label"
            >
              {ARENA_ENTRY_UNITS.map((units) => (
                <button
                  key={units.toString()}
                  type="button"
                  role="radio"
                  aria-checked={units === entryUnits}
                  className={units === entryUnits ? "selected" : ""}
                  onClick={() => setEntryUnits(units)}
                  disabled={busy}
                >
                  {fmtEntry(units)}
                  <small className="deck-price">USDT</small>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label id="room-players-label">{t("room.config.max")}</label>
            <div
              className="rounds-options"
              role="radiogroup"
              aria-labelledby="room-players-label"
            >
              {ARENA_PLAYER_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={n === maxPlayers}
                  className={n === maxPlayers ? "selected" : ""}
                  onClick={() => setMaxPlayers(n)}
                  disabled={busy}
                >
                  {n}
                  <small className="deck-price">{t("arena.players.unit")}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="arena-prize" aria-live="polite">
            <div className="arena-prize-row">
              <span>{t("arena.prize.pot")}</span>
              <strong>{fmtUsdt(prize.potUnits)} USDT</strong>
            </div>
            <div className="arena-prize-row arena-prize-fee">
              <span>{t("arena.prize.fee")}</span>
              <strong>−{fmtUsdt(prize.commissionUnits)} USDT</strong>
            </div>
            <div className="arena-prize-row arena-prize-win">
              <span>{t("arena.prize.winner")}</span>
              <strong>{fmtUsdt(prize.winnerUnits)} USDT</strong>
            </div>
          </div>

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
      ) : preview ? (
        /* ---- UNIRSE, paso 2: la mesa del anfitrión, tal cual es ---- */
        <RoomPreview
          room={preview}
          busy={busy}
          error={error}
          onConfirm={confirmJoin}
          onBack={() => {
            setPreview(null);
            setError(null);
          }}
        />
      ) : (
        /* ---- UNIRSE, paso 1: solo el código. Ni un selector. ---- */
        <form
          className="arena-card arena-setup"
          onSubmit={lookup}
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
            disabled={busy || !normalizeRoomCode(code)}
          >
            {busy ? t("room.join.looking") : t("room.join.lookup")}
          </button>

          <Link className="lobby-ranking-link" href="/arena">
            {t("arena.soon.back_lobby")}
          </Link>
        </form>
      )}
    </>
  );
}

/**
 * La mesa que armó otro, antes de aceptarla.
 *
 * Enseña lo mismo que vería el anfitrión —entrada, cupo, pozo, premio— más la
 * ocupación, que es lo único que el invitado necesita y el anfitrión no: saber
 * si todavía cabe. Y lo dice sin rodeos: esto lo decidió el anfitrión.
 */
function RoomPreview({
  room,
  busy,
  error,
  onConfirm,
  onBack,
}: {
  room: RoomView;
  busy: boolean;
  error: RoomError | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const entryUnits = BigInt(room.entryUnits);
  const prize = arenaPrize(entryUnits, room.maxPlayers);
  const full = roomIsFull(room);
  const alreadyIn = room.you !== null;

  return (
    <section className="arena-card arena-setup" aria-label={t("room.preview.aria")}>
      <header className="room-preview-head">
        <span className="room-preview-code">{room.code}</span>
        <h2 className="arena-hero-title">{t("room.preview.title")}</h2>
        <p className="arena-prize-note">{t("room.preview.host_decides")}</p>
      </header>

      <dl className="arena-recap">
        <div className="arena-recap-item">
          <dt>{t("arena.entry.label")}</dt>
          <dd>{fmtEntry(entryUnits)} USDT</dd>
        </div>
        <div className="arena-recap-item">
          <dt>{t("room.config.max")}</dt>
          <dd>
            {room.maxPlayers} {t("arena.players.unit")}
          </dd>
        </div>
        <div className="arena-recap-item">
          <dt>{t("room.preview.occupancy")}</dt>
          <dd>
            {room.players.length}/{room.maxPlayers}
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

      {alreadyIn ? (
        <Link className="btn-primary room-preview-link" href={`/arena/sala/${room.code}`}>
          {t("room.preview.already")}
        </Link>
      ) : full ? (
        <p className="room-warn">{t("room.error.full")}</p>
      ) : (
        <button
          type="button"
          className="btn-primary"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? t("room.join.joining") : t("room.preview.confirm")}
        </button>
      )}

      <button type="button" className="room-leave" onClick={onBack} disabled={busy}>
        {t("room.preview.back")}
      </button>
    </section>
  );
}
