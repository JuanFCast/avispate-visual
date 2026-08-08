"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ARENA_ENTRY_UNITS,
  ARENA_PLAYABLE_PLAYERS,
  DEFAULT_ENTRY_UNITS,
  DEFAULT_PLAYERS,
  arenaPrize,
  fmtEntry,
  fmtUsdt,
} from "@/lib/arena";
import { clampCards, defaultCardsPerPlayer } from "@/lib/arena-deck";
import { roomErrorText } from "@/lib/arena-room-errors";
import type { RoomError } from "@/lib/arena-rooms";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import { ARENA_ESCROW_ADDRESS } from "@/lib/arena-join";
import { useT } from "@/lib/i18n/client";
import ArenaCards from "./ArenaCards";
import ArenaHeader from "./ArenaHeader";

/**
 * La tarjeta de acceso llega aparte, y es el cambio de peso más grande de la
 * app: es la única que usa `useWalletAuth` → `useLoginWithSiwe` de Privy, y ese
 * camino arrastra WalletConnect, Coinbase y el catálogo entero de wallets de
 * RainbowKit. Estáticamente importada, ese megabyte viajaba al teléfono en cada
 * visita a esta pantalla — incluida la del jugador que ya tiene sesión y por
 * tanto NUNCA ve la tarjeta.
 *
 * `ssr: false` porque no hay nada que prerenderizar: solo se pinta cuando el
 * cliente ya sabe que no hay sesión.
 */
const AccessCard = dynamic(() => import("../AccessCard"), {
  ssr: false,
  loading: () => <div className="access-card-skeleton" aria-hidden="true" />,
});

/**
 * /arena/crear — la ÚNICA pantalla de configuración del recorrido.
 *
 * Antes lo que se elegía aquí se elegía dos veces: una en el lobby y otra al
 * llegar, con etiquetas distintas para lo mismo ("Jugadores en la mesa" vs
 * "Jugadores máximo"). Ahora se pregunta una vez, y se pregunta a quien puede
 * responder: el anfitrión. Quien entra con un código no ve ni uno de estos
 * controles — acepta la sala que le proponen.
 *
 * El pozo se muestra aquí una sola vez y como ESTIMADO. La cifra que importa
 * —la real, contra la que se decide— vive en la sala, que es donde algún día
 * habrá algo que confirmar. Repetirla tres veces por el camino solo la vuelve
 * ruido.
 *
 * Hoy no se cobra nada en ningún punto de este recorrido, y la pantalla lo dice
 * en vez de insinuar lo contrario.
 */
export default function ArenaCreate() {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated, getToken } = useProfile();
  const wallet = useActiveWallet();

  /**
   * Se puede montar la mesa sin sesión cuando va a cobrar entrada y hay una
   * wallet puesta. Es el caso del usuario nuevo de MiniPay: allí no se puede
   * firmar un mensaje, así que su sesión nace del pago — y para pagar hace
   * falta la sala. Crear no le da nada; la silla se la dará la transacción.
   */
  const puedePagarDespues =
    Boolean(ARENA_ESCROW_ADDRESS) && wallet.isConnected && Boolean(wallet.address);

  const [entryUnits, setEntryUnits] = useState<bigint>(DEFAULT_ENTRY_UNITS);
  const [players, setPlayers] = useState<number>(DEFAULT_PLAYERS);
  const [cards, setCards] = useState<number>(() =>
    defaultCardsPerPlayer(DEFAULT_PLAYERS)
  );

  /**
   * Cambiar de tamaño de mesa cambia cuántas cartas caben: con dos jugadores el
   * máximo son 27 y con cuatro son 13. Si el número que había se sale del nuevo
   * rango, se recorta; si cabía, se respeta, porque elegir "una rapidita" no
   * debería deshacerse por sumar un jugador.
   */
  function choosePlayers(n: number) {
    setPlayers(n);
    setCards((c) => clampCards(c, n));
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);

  const prize = arenaPrize(entryUnits, players);

  async function create() {
    setError(null);
    setBusy(true);
    const token = authenticated ? await getToken() : null;
    if (!token && !puedePagarDespues) {
      setError("unauthorized");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/arena/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          entry: entryUnits.toString(),
          players,
          cards,
          // Sin sesión: a qué wallet se le atribuye la sala. No prueba nada y no
          // hace falta que lo pruebe — quien acabe sentado será quien pague.
          ...(token ? {} : { address: wallet.address }),
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

  return (
    <>
      <ArenaHeader
        backHref="/arena"
        title={t("create.title")}
        lead={t("create.lead")}
      />

      {ready && !authenticated && !puedePagarDespues ? (
        <section className="arena-card room-login">
          <h2 className="arena-hero-title">{t("room.login.title")}</h2>
          <p className="arena-hero-text">{t("room.login.text")}</p>
          <AccessCard />
        </section>
      ) : (
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

          {/* Vuelve a ser un selector: ahora las tres mesas se pueden jugar de
              verdad, así que hay algo que elegir. */}
          <div className="field">
            <label id="room-players-label">{t("arena.players.label")}</label>
            <div
              className="rounds-options"
              role="radiogroup"
              aria-labelledby="room-players-label"
            >
              {ARENA_PLAYABLE_PLAYERS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={n === players}
                  className={n === players ? "selected" : ""}
                  onClick={() => choosePlayers(n)}
                  disabled={busy}
                >
                  {n}
                  <small className="deck-price">{t("arena.players.unit")}</small>
                </button>
              ))}
            </div>
          </div>

          <ArenaCards
            cards={cards}
            players={players}
            onChange={setCards}
            disabled={busy}
          />

          {/*
            El pozo y la comisión comparten renglón; lo que se lleva el ganador
            se queda solo abajo, que es la cifra con la que se decide entrar.

            La comisión NO se esconde aunque estorbe al alto. Es el corte de la
            casa en la pantalla donde alguien está a punto de poner plata: si
            solo se enseñara el premio, el 20% aparecería después como sorpresa.
            El "USDT" se dice una vez, en la línea del ganador — repetirlo tres
            veces era la mitad del ancho de las otras dos.
          */}
          <div className="arena-prize" aria-live="polite">
            <div className="arena-prize-meta">
              <span>
                {t("arena.prize.pot")} <strong>{fmtUsdt(prize.potUnits)}</strong>
              </span>
              <span>
                {t("arena.prize.fee")}{" "}
                <strong>−{fmtUsdt(prize.commissionUnits)}</strong>
              </span>
            </div>
            <div className="arena-prize-row arena-prize-win">
              <span>{t("arena.prize.winner")}</span>
              <strong>{fmtUsdt(prize.winnerUnits)} USDT</strong>
            </div>
          </div>

          <p className="arena-prize-note">{t("create.note")}</p>

          {error && <p className="room-error">{roomErrorText(t, error)}</p>}

          {/* Tres estados, no dos: trabajando, arrancando y listo. El de
              "arrancando" faltaba, y era el que hacía tocar tres veces. */}
          <button
            type="button"
            className="btn-primary"
            onClick={create}
            disabled={busy || !ready}
            aria-busy={busy || !ready}
          >
            {busy
              ? t("room.create.creating")
              : !ready
                ? t("common.warming")
                : t("room.create.cta")}
          </button>
        </section>
      )}
    </>
  );
}
