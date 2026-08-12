"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { arenaPrize, fmtEntry, fmtUsdt } from "@/lib/arena";
import { dealSummary } from "@/lib/arena-deck";
import { useArenaRoom } from "@/lib/arena-room";
import { roomErrorText } from "@/lib/arena-room-errors";
import {
  roomActionsFor,
  roomIsFull,
  seatEntryGateFor,
  startHintFor,
  startHintMessage,
  type RoomPlayerView,
} from "@/lib/arena-rooms";
import { useProfile } from "@/lib/profile-context";
import { useIsMiniPay } from "@/lib/minipay";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n";
import ArenaHeader from "./ArenaHeader";

/**
 * Igual que en `/arena/crear`: la tarjeta de acceso arrastra el camino SIWE de
 * Privy con WalletConnect y el catálogo de wallets, y aquí solo se pinta cuando
 * alguien llega por el enlace de un amigo sin sesión. Quien ya está sentado no
 * tiene por qué descargarlo.
 */
import ArenaSeatPayment from "./ArenaSeatPayment";
import { useArenaJoin } from "@/lib/arena-join";
import { seatTokenFor } from "@/lib/seat-token-client";
import { useActiveWallet } from "@/lib/wallet";

const AccessCard = dynamic(() => import("../AccessCard"), {
  ssr: false,
  loading: () => <div className="access-card-skeleton" aria-hidden="true" />,
});

/** Cuánto se queda "Copiado ✓" antes de volver a ser un botón normal. */
const COPIED_MS = 1600;

/** Latidos perdidos seguidos a partir de los cuales el desconectado eres tú. */
const OFFLINE_AFTER = 3;

/**
 * /arena/sala/[codigo] — donde convergen los dos caminos.
 *
 * El que armó la sala llega aquí desde la pantalla de configurar; el que trae
 * un código llega desde la de escribirlo. Es la MISMA pantalla para los dos, y
 * lo que cambia no es la estructura sino el estado: quién ya está sentado, si
 * falta gente y de quién es el turno de tocar el botón.
 *
 * Aquí el resumen de la sala es de SOLO LECTURA, y a propósito: el invitado la
 * ve por primera vez —nunca configuró nada— y el anfitrión ya decidió. Un
 * control editable en esta pantalla significaría que la sala puede cambiar bajo
 * los pies de quien ya dijo que sí.
 *
 * Recargar no pierde el sitio: la silla vive en el servidor, no en la pestaña.
 *
 * No se cobra, no se bloquean fondos y no se reparte ningún pozo. Por eso el
 * botón dice "Estoy listo" y no "Confirmar y pagar".
 */
export default function ArenaRoom({ code }: { code: string }) {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated } = useProfile();
  const inMiniPay = useIsMiniPay();
  const {
    room,
    error,
    loading,
    busy,
    failures,
    join,
    setReady,
    leave,
    start,
    authHeaders,
    refresh,
  } = useArenaRoom(code);

  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const wallet = useActiveWallet();
  const { claimSeatToken } = useArenaJoin();

  /**
   * Sentado en una mesa con entrada pero sin ficha: el servidor va a rechazar
   * cada acción por falta de permiso, y el jugador no tiene forma de pedirla.
   *
   * Ocurre cuando la silla se registró pero el canje no llegó a hacerse — pasó
   * en la primera prueba real. El secreto sigue en el dispositivo, así que se
   * canjea solo, sin molestar a nadie y sin volver a tocar la cadena.
   */
  useEffect(() => {
    const tableId = room?.tableId;
    const mine = room?.you;
    if (!tableId || !mine || !wallet.address) return;
    if (seatTokenFor(room.code)) return;
    void claimSeatToken({
      code: room.code,
      tableId: tableId as `0x${string}`,
      address: wallet.address,
    }).then((ok) => {
      if (ok) refresh();
    });
  }, [room?.tableId, room?.you, room?.code, wallet.address, claimSeatToken, refresh]);

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
    router.push("/arena");
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

  /*
   * La mesa ya repartió: el efecto de arriba está llevando a la partida y aquí
   * solo se acompaña la espera.
   *
   * Va ANTES de mirar si la sala está cerrada, y ese orden importa: al terminar
   * una partida la sala se cierra (para que deje de contar como abierta en el
   * aviso de la Arena), así que quien vuelva a esta URL vería un "sala cerrada"
   * parpadeando antes de la redirección. Eso cuenta una avería que no hubo —la
   * partida existe y es a donde va— y en la primera prueba real es justo el
   * tipo de destello que hace dudar de si algo se rompió.
   */
  if (room.matchStarted) {
    return (
      <section className="arena-card room-state" aria-busy="true">
        <p className="arena-hero-text">{t("room.going_to_match")}</p>
      </section>
    );
  }

  if (room.status === "closed") {
    return <RoomProblem t={t} message={t("room.error.closed")} />;
  }

  const entryUnits = BigInt(room.entryUnits);
  const prize = arenaPrize(entryUnits, room.maxPlayers);
  const runtime = dealSummary(room.cardsPerPlayer, room.maxPlayers);
  const full = roomIsFull(room);
  const actions = roomActionsFor(room);
  const emptySeats = Math.max(0, room.maxPlayers - room.players.length);
  const you = room.you;
  const youOffline = failures >= OFFLINE_AFTER;
  // Qué falta para poder repartir. Se decide fuera del JSX, en una función pura
  // que `scripts/verify-arena-ready.ts` recorre entera.
  const hintText = startHintMessage(startHintFor(room), Boolean(you?.isHost));
  // Qué pantalla le toca a quien no tiene silla. Puro, por lo mismo que el
  // aviso de arriba — `scripts/verify-arena-fee-currency.ts` recorre el caso
  // MiniPay sin necesitar un navegador.
  const entryGate = seatEntryGateFor({
    seated: Boolean(you),
    full,
    ready,
    authenticated,
    inMiniPay,
    hasTableId: Boolean(room.tableId),
  });

  return (
    <>
      <ArenaHeader
        backHref="/arena"
        title={t("room.title")}
        lead={you?.isHost ? t("room.subtitle.host") : t("room.subtitle.guest")}
      />

      {/* El código, que es a lo que se viene: grande, seleccionable y con los
          dos botones que lo sacan de aquí.

          Solo para quien ya está sentado. Al que llegó por el enlace y todavía
          no entró no le sirve compartirlo —él lo acaba de recibir—: lo que
          necesita ver primero es la sala y el botón de unirse. */}
      {you && (
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
      )}

      {/* La sala tal como quedó. Se lee, no se toca: quien la armó ya decidió y
          quien llegó con el código la ve aquí por primera vez. */}
      <section className="arena-card arena-setup" aria-label={t("room.recap.aria")}>
        <h2 className="room-section-title">{t("room.recap.title")}</h2>
        <dl className="arena-recap">
          <div className="arena-recap-item">
            <dt>{t("arena.entry.label")}</dt>
            <dd>{fmtEntry(entryUnits)} USDT</dd>
          </div>
          <div className="arena-recap-item">
            <dt>{t("arena.players.label")}</dt>
            <dd>
              {room.maxPlayers} {t("arena.players.unit")}
            </dd>
          </div>
          <div className="arena-recap-item">
            <dt>{t("cards.label")}</dt>
            <dd>{t("cards.each", { n: room.cardsPerPlayer })}</dd>
          </div>
          <div className="arena-recap-item">
            <dt>{t("cards.summary.time")}</dt>
            <dd>{t("cards.summary.minutes", { n: runtime.minutes })}</dd>
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
        {!room.tableId && (
          <p className="arena-prize-note">{t("room.no_charge")}</p>
        )}
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
          /* Llegó por el enlace y todavía no se sentó. Qué le toca ver lo
             decide `seatEntryGateFor` (`lib/arena-rooms.ts`), no esta rama:
             la única excepción a "sin sesión, primero AccessCard" es MiniPay
             + mesa de pago, donde pagar la silla ES la forma de abrir sesión
             (`arena-join.ts` canjea el propio txHash). Mandarlo por
             AccessCard ahí solo lo empujaría al reto individual sin
             necesidad — el rodeo que `onchain.ts` ya dejó de exigir en el
             servidor. Fuera de MiniPay, o en una mesa gratis, no cambia. */
          entryGate === "full" ? (
            <p className="room-warn">{t("room.error.full")}</p>
          ) : entryGate === "needs_login" ? (
            <>
              <p className="room-warn">{t("room.join_this.login")}</p>
              <AccessCard />
            </>
          ) : entryGate === "pay_seat" && room.tableId ? (
            /* Mesa con entrada: aquí no se "entra", se paga. La silla la crea
               la transacción, no este botón, y por eso vale igual para el
               anfitrión —que con escrow tampoco se sentó al crear la sala—. */
            <ArenaSeatPayment
              code={room.code}
              tableId={room.tableId}
              entryUnits={entryUnits}
              maxPlayers={room.maxPlayers}
              authHeaders={authHeaders}
              onSeated={refresh}
            />
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={join}
              disabled={busy || !ready}
              aria-busy={busy || !ready}
            >
              {busy
                ? t("room.join.joining")
                : !ready
                  ? t("common.warming")
                  : t("room.join_this.cta")}
            </button>
          )
        ) : (
          <>
            {/* Confirmar es de TODOS, también de quien montó la mesa. Nadie
                queda listo por crear la sala ni por pagar: pagar da la silla,
                no la voluntad de empezar. Es un estado en nuestra base — sin
                firma, sin transacción y sin tarifa de red.

                Y aparece SOLO mientras falte confirmar. Ya confirmado, este
                botón desaparece: lo que dice que estás listo es tu tarjeta de
                la lista de arriba, y el sitio del botón grande queda libre para
                lo único que importa entonces, que es repartir. */}
            {actions.canConfirm && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setReady(true)}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? t("room.ready.saving") : t("room.ready.on")}
              </button>
            )}

            {you.isHost && (
              <button
                type="button"
                className="arena-cta room-start"
                onClick={start}
                disabled={!actions.canStart || busy}
              >
                {busy ? t("room.start.dealing") : t("room.start.cta")}
              </button>
            )}

            {/* Qué falta, con cifras. El botón apagado dice que no se puede;
                esto dice por qué, que es lo único accionable. */}
            <p className="arena-prize-note" aria-live="polite">
              {t(hintText.key, hintText.vars)}
            </p>

            {/* Deshacer existe, pero no compite: una píldora pequeña debajo del
                protagonista, no un segundo botón del mismo tamaño. */}
            {actions.canUndo && (
              <button
                type="button"
                className="room-undo-ready"
                onClick={() => setReady(false)}
                disabled={busy}
              >
                {busy ? t("room.ready.saving") : t("room.ready.undo")}
              </button>
            )}
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
      </section>
    </>
  );
}

/**
 * Una silla ocupada: quién es, si manda, si está listo y si sigue ahí.
 *
 * El estado se ve AQUÍ y no en un botón. Desde que confirmar dejó de ser un
 * conmutador, esta píldora es la única respuesta a "¿ya dije que estoy listo?",
 * así que tiene que contestarla de un vistazo: verde con su palomita, y con la
 * fila resaltada cuando la silla es la tuya, que es la que vas a buscar.
 */
function SeatFilled({ player, t }: { player: RoomPlayerView; t: Translate }) {
  const name = player.name || t("room.players.anon");
  // Desconectado manda sobre "listo": de nada sirve que dijera que sí si ya no
  // está mirando la pantalla.
  const listo = player.online && player.isReady;
  return (
    <li
      className={`room-seat${player.isYou ? " room-seat-mine" : ""}${
        player.online ? "" : " room-seat-offline"
      }`}
    >
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
      <span className={`room-seat-state${listo ? " ready" : ""}`}>
        {/* La palomita va aparte y oculta a los lectores de pantalla: el estado
            ya se dice con palabras y "marca de verificación Listo" sobra. */}
        {listo && <span aria-hidden="true">✓ </span>}
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
      <h1 className="arena-hero-title">{t("room.error.title")}</h1>
      <p className="arena-hero-text">{message}</p>
      <Link className="arena-cta" href="/arena">
        {t("room.error.cta")}
      </Link>
    </section>
  );
}
