"use client";

import { useState } from "react";
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
import { useT } from "@/lib/i18n/client";
import AccessCard from "../AccessCard";
import ArenaCards from "./ArenaCards";
import ArenaHeader from "./ArenaHeader";

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
          players,
          cards,
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

      {ready && !authenticated ? (
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

          <p className="arena-prize-note">{t("create.note")}</p>

          {error && <p className="room-error">{roomErrorText(t, error)}</p>}

          <button
            type="button"
            className="btn-primary"
            onClick={create}
            disabled={busy || !ready}
          >
            {busy ? t("room.create.creating") : t("room.create.cta")}
          </button>
        </section>
      )}
    </>
  );
}
