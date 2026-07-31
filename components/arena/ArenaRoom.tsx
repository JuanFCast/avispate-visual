"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { arenaPrize, fmtEntry, fmtUsdt } from "@/lib/arena";
import { useArenaRoom } from "@/lib/arena-room";
import { roomErrorText } from "@/lib/arena-room-errors";
import { roomCanStart, roomIsFull, type RoomPlayerView } from "@/lib/arena-rooms";
import { useProfile } from "@/lib/profile-context";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";

/** Cuánto se queda "Copiado ✓" antes de volver a ser un botón normal. */
const COPIED_MS = 1600;

/** Latidos perdidos seguidos a partir de los cuales el desconectado eres tú. */
const OFFLINE_AFTER = 3;

/**
 * /arena/sala/[codigo] — la mesa privada mientras se llena.
 *
 * Lo que hay que ver de un vistazo, en este orden: el código (para compartirlo,
 * que es a lo que se viene), la mesa que se acordó y quién falta. El botón de
 * iniciar es del anfitrión y no arranca nada todavía —lo dice él mismo al
 * tocarlo—; los demás solo se marcan listos.
 *
 * Recargar no pierde el sitio: la silla vive en el servidor, no en la pestaña,
 * así que volver a esta URL vuelve a sentarte donde estabas.
 *
 * No se cobra, no se bloquean fondos y no se reparte ningún pozo.
 */
export default function ArenaRoom({ code }: { code: string }) {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated } = useProfile();
  const { room, error, loading, busy, failures, join, setReady, leave, start } =
    useArenaRoom(code);

  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);

  /*
   * El anfitrión repartió: a la mesa. Los dos llegan por aquí —el invitado
   * nunca tocó nada, se enteró en su latido—, y `replace` en vez de `push`
   * para que el "atrás" del teléfono no devuelva a una sala que ya empezó.
   */
  useEffect(() => {
    if (room?.matchStarted) router.replace(`/arena/partida/${room.code}`);
  }, [room?.matchStarted, room?.code, router]);

  const shareUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/arena/sala/${code}`;

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("code");
    } catch {
      // Sin permiso de portapapeles el código sigue a la vista para dictarlo.
    }
  }, [code]);

  const share = useCallback(async () => {
    const text = t("room.share.text", { code });
    if (navigator.share) {
      try {
        await navigator.share({ title: t("room.share.title"), text, url: shareUrl });
        return;
      } catch {
        // Cancelar el diálogo del sistema no es un fallo que reportar.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied("link");
    } catch {
      // Ídem: queda el botón de copiar el código.
    }
  }, [code, shareUrl, t]);

  async function onLeave() {
    await leave();
    router.push("/arena/privada");
  }

  if (loading && !room) {
    return (
      <section className="arena-card room-state" aria-busy="true">
        <p className="arena-hero-text">{t("room.loading")}</p>
      </section>
    );
  }

  // Código inválido, sala inexistente o servidor caído sin nada que mostrar.
  if (!room) {
    return <RoomProblem t={t} message={roomErrorText(t, error)} />;
  }

  if (room.status === "closed") {
    return <RoomProblem t={t} message={t("room.error.closed")} />;
  }

  const entryUnits = BigInt(room.entryUnits);
  const prize = arenaPrize(entryUnits, room.maxPlayers);
  const full = roomIsFull(room);
  const canStart = roomCanStart(room);
  const emptySeats = Math.max(0, room.maxPlayers - room.players.length);
  const you = room.you;
  const youOffline = failures >= OFFLINE_AFTER;

  return (
    <>
      <header className="arena-lobby-head">
        <span className="arena-tag">{t("room.tag")}</span>
        <h1 className="page-title">{t("room.title")}</h1>
        <p className="page-lead">{t("room.subtitle")}</p>
      </header>

      {/* El código, que es a lo que se viene: grande, seleccionable y con los
          dos botones que lo sacan de aquí. */}
      <section className="arena-card room-code-card" aria-label={t("room.code.label")}>
        <span className="room-code-label">{t("room.code.label")}</span>
        <strong className="room-code-value">{room.code}</strong>
        <div className="room-code-actions">
          <button type="button" className="room-code-btn" onClick={copyCode}>
            {copied === "code" ? t("room.code.copied") : t("room.code.copy")}
          </button>
          <button type="button" className="room-code-btn" onClick={share}>
            {copied === "link" ? t("room.code.link_copied") : t("room.code.share")}
          </button>
        </div>
        <small className="room-code-hint">{t("room.code.hint")}</small>
      </section>

      <section className="arena-card arena-setup" aria-label={t("arena.setup.aria")}>
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
            <dt>{t("arena.prize.pot")}</dt>
            <dd>{fmtUsdt(prize.potUnits)} USDT</dd>
          </div>
          <div className="arena-recap-item arena-recap-win">
            <dt>{t("arena.prize.winner")}</dt>
            <dd>{fmtUsdt(prize.winnerUnits)} USDT</dd>
          </div>
        </dl>
        <p className="arena-prize-note">{t("room.create.note")}</p>
      </section>

      <section className="arena-card room-players" aria-label={t("room.players.aria")}>
        <div className="room-players-head">
          <h2 className="room-players-title">{t("room.players.title")}</h2>
          <span className="room-players-count" aria-live="polite">
            {room.players.length}/{room.maxPlayers}
          </span>
        </div>

        <ul className="room-seats">
          {room.players.map((p) => (
            <SeatFilled key={p.profileId} player={p} t={t} />
          ))}
          {Array.from({ length: emptySeats }, (_, i) => (
            <li key={`empty-${i}`} className="room-seat room-seat-empty">
              <span className="room-seat-avatar room-seat-avatar-empty" aria-hidden="true">
                +
              </span>
              <span className="room-seat-name">{t("room.players.empty")}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="arena-card room-actions">
        {youOffline && (
          <p className="room-warn" role="status">
            {t("room.error.you_offline")}
          </p>
        )}

        {!you ? (
          /* Llegó por el enlace y todavía no se sentó. */
          full ? (
            <p className="room-warn">{t("room.error.full")}</p>
          ) : ready && !authenticated ? (
            <p className="room-warn">{t("room.join_this.login")}</p>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={join}
              disabled={busy || !ready}
            >
              {busy ? t("room.join.joining") : t("room.join_this.cta")}
            </button>
          )
        ) : you.isHost ? (
          <>
            <button
              type="button"
              className="btn-primary"
              onClick={start}
              disabled={!canStart || busy}
            >
              {busy ? t("room.start.dealing") : t("room.start.cta")}
            </button>
            <p className="arena-prize-note" aria-live="polite">
              {!full
                ? t("room.start.need_players")
                : !canStart
                  ? t("room.start.need_ready")
                  : t("room.start.ready")}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`btn-primary${you.isReady ? " room-ready-on" : ""}`}
              onClick={() => setReady(!you.isReady)}
              disabled={busy}
            >
              {you.isReady ? t("room.ready.off") : t("room.ready.on")}
            </button>
            <p className="arena-prize-note">{t("room.guest.hint")}</p>
          </>
        )}

        {error && <p className="room-error">{roomErrorText(t, error)}</p>}

        {you && (
          <button
            type="button"
            className="room-leave"
            onClick={onLeave}
            disabled={busy}
          >
            {you.isHost ? t("room.leave.host") : t("room.leave.guest")}
          </button>
        )}

        <Link className="lobby-ranking-link" href="/arena/privada">
          {t("room.back")}
        </Link>
      </section>
    </>
  );
}

/** Una silla ocupada: quién es, si manda, si está listo y si sigue ahí. */
function SeatFilled({ player, t }: { player: RoomPlayerView; t: Translate }) {
  const name = player.name || t("room.players.anon");
  return (
    <li className={`room-seat${player.online ? "" : " room-seat-offline"}`}>
      <span className="room-seat-avatar" aria-hidden="true">
        {player.initial}
      </span>
      <span className="room-seat-body">
        <span className="room-seat-name">
          {name}
          {player.isYou && <em className="room-seat-you">{t("room.players.you")}</em>}
        </span>
        {player.isHost && (
          <small className="room-seat-host">{t("room.players.host")}</small>
        )}
      </span>
      {/* Desconectado manda sobre "listo": de nada sirve que dijera que sí si
          ya no está mirando la pantalla. */}
      <span
        className={`room-seat-state${player.online && player.isReady ? " ready" : ""}`}
      >
        {!player.online
          ? t("room.players.offline")
          : player.isReady
            ? t("room.players.ready")
            : t("room.players.waiting")}
      </span>
    </li>
  );
}

/** Sala que no se puede mostrar: se dice por qué y por dónde se sale. */
function RoomProblem({ t, message }: { t: Translate; message: string }) {
  return (
    <section className="arena-card arena-hero room-state">
      <span className="arena-tag">{t("room.tag")}</span>
      <h1 className="arena-hero-title">{t("room.error.title")}</h1>
      <p className="arena-hero-text">{message}</p>
      <Link className="arena-cta" href="/arena/privada">
        {t("room.error.cta")}
      </Link>
    </section>
  );
}
