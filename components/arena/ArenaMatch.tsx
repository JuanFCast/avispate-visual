"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { placeMatchCard, sharedSymbol } from "@/lib/arena-deck";
import { useArenaMatch } from "@/lib/arena-match-client";
import { countdownNumber } from "@/lib/arena-match";
import { useT } from "@/lib/i18n/client";
import { isMuted, setMuted, sound, unlockAudio } from "@/lib/sound";
import CardView from "../CardView";
import ArenaMatchOver from "./ArenaMatchOver";
import ArenaMatchPlayers from "./ArenaMatchPlayers";

/** Lo que tarda la carta vieja en salir de cuadro. Igual que en el individual. */
const EXIT_MS = 600;
/** Cuánto se queda el destello de acierto o de error. */
const FLASH_MS = 280;
/**
 * El de "llegaste tarde" dura más. No es vanidad de animación: es el único de
 * los tres que además tiene que EXPLICARSE, y 280 ms no alcanzan para leer por
 * qué el toque bueno que acabas de dar no movió nada.
 */
const LATE_FLASH_MS = 750;
/** Cada cuánto se repinta el reloj y la cuenta regresiva. */
const TICK_MS = 100;
/** Latidos perdidos a partir de los cuales el desconectado eres tú. */
const OFFLINE_AFTER = 3;

type Role = "base" | "incoming" | "exiting";

/**
 * Por dónde entró la carta al tablero.
 *
 * No es decoración: es quién la puso. Tu mazo está abajo y de ahí salen tus
 * cartas; la base la cambia otro y por eso baja desde arriba, que es donde
 * está la franja del rival. Cuando las dos entraban por abajo, la carta del
 * rival parecía tuya y el tablero mentía sobre quién acababa de jugar.
 */
type Entry = "deck" | "above";

interface VisualCard {
  /** Identidad estable del elemento. Una carta reciclada por castigo puede
      repetir índice, y dos elementos con la misma llave romperían la animación. */
  key: number;
  card: number;
  symbols: string[];
  role: Role;
  entry: Entry;
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

/**
 * /arena/partida/[codigo] — la partida de dos, con la base compartida.
 *
 * El tablero es EXACTAMENTE el del reto diario: la base arriba, tu carta abajo,
 * los mismos tamaños y las mismas animaciones. Lo único nuevo es la franja de
 * jugadores y que la base ya no es solo tuya — cuando el rival acierta, su
 * carta baja aquí y tienes que volver a buscar contra ella.
 *
 * Quién acierta lo dice el servidor. La pantalla se adelanta un instante para
 * que el toque se sienta inmediato —el destello sale antes de que la respuesta
 * vuelva— pero si el servidor dice que llegaste tarde, se borra sin castigo.
 *
 * Recargar no pierde nada: no hay estado de partida en esta pantalla que no
 * venga del servidor, así que volver a la URL vuelve a la misma jugada.
 */
export default function ArenaMatch({ code }: { code: string }) {
  const t = useT();
  const { view, error, loading, failures, serverNow, play, leave } =
    useArenaMatch(code);

  const [, setTick] = useState(0);
  const [cards, setCards] = useState<VisualCard[]>([]);
  const [feedback, setFeedback] = useState<{
    symbolId: string;
    type: "good" | "bad" | "late";
  } | null>(null);
  const [shake, setShake] = useState(false);
  const [penaltyKey, setPenaltyKey] = useState(0);
  const [lateKey, setLateKey] = useState(0);
  const [muted, setMutedState] = useState(false);

  const shown = useRef<{ base: number | null; mine: number | null }>({
    base: null,
    mine: null,
  });
  const instance = useRef(0);
  const lastCount = useRef<number | null>(null);

  useEffect(() => {
    setMutedState(isMuted());
  }, []);

  function toggleMuted() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) unlockAudio();
  }

  // Un repintado corto y constante: el reloj sube y la cuenta regresiva baja
  // aunque no llegue nada del servidor.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const phase = view?.phase ?? "countdown";
  const count = view ? countdownNumber(view.startsAt, serverNow()) : 3;

  // 3, 2, 1, ¡ya! El sonido sigue al número, y el número sale del reloj del
  // servidor, así que los dos teléfonos cantan a la vez.
  useEffect(() => {
    if (!view || phase !== "countdown") return;
    if (lastCount.current === count) return;
    lastCount.current = count;
    unlockAudio();
    sound.tick();
  }, [count, phase, view]);

  // El "¡ya!" solo suena si venías contando. Quien recarga a mitad de partida
  // entra sin bocinazo: para él no empieza nada, sigue.
  useEffect(() => {
    if (phase !== "playing") return;
    const counted = lastCount.current;
    lastCount.current = 0;
    if (counted !== null && counted > 0) sound.go();
  }, [phase]);

  /*
   * De la foto del servidor al tablero.
   *
   * El truco de la animación es que la carta NO se vuelve a crear cuando
   * asciende: el mismo elemento cambia de papel y el CSS lo lleva de un sitio a
   * otro. Por eso se busca primero si la carta que ahora es base ya estaba en
   * pantalla como tuya —entonces sube— y solo si no estaba se crea.
   *
   * Y ahí está la distinción que importa: si hubo que crearla, es que no salió
   * de tu mano. La puso otro, así que entra por arriba. Las tuyas siempre
   * suben desde el mazo.
   */
  useEffect(() => {
    if (!view) return;
    const prev = shown.current;
    if (prev.base === view.baseCard && prev.mine === view.myCard) return;

    setCards((list) => {
      let next = list;

      if (prev.base !== null && prev.base !== view.baseCard) {
        next = next.map((c) =>
          c.card === prev.base && c.role === "base"
            ? { ...c, role: "exiting" as Role }
            : c
        );
      }

      if (prev.base !== view.baseCard) {
        const mineRising = next.find(
          (c) => c.card === view.baseCard && c.role === "incoming"
        );
        next = mineRising
          ? next.map((c) =>
              c === mineRising ? { ...c, role: "base" as Role } : c
            )
          : next.concat({
              key: ++instance.current,
              card: view.baseCard,
              symbols: view.baseSymbols,
              role: "base",
              entry: "above",
            });
      }

      if (view.myCard !== null && prev.mine !== view.myCard && view.mySymbols) {
        next = next.concat({
          key: ++instance.current,
          card: view.myCard,
          symbols: view.mySymbols,
          role: "incoming",
          entry: "deck",
        });
      }

      return next;
    });

    shown.current = { base: view.baseCard, mine: view.myCard };
    // Sin `clearTimeout` en la limpieza a propósito: este efecto vuelve a
    // correr con cada latido, y cancelar aquí dejaría la carta saliente clavada
    // en pantalla para siempre. Barrer de más no rompe nada; no barrer, sí.
    setTimeout(() => setCards((l) => l.filter((c) => c.role !== "exiting")), EXIT_MS);
  }, [view]);

  const onTap = useCallback(
    async (symbolId: string) => {
      if (!view || view.phase !== "playing" || view.myCard === null) return;
      if (!view.mySymbols) return;

      // Adelanto local. El cliente puede calcular esto porque tiene las dos
      // cartas que ve; no le sirve para hacer trampa (el servidor vuelve a
      // juzgar) y ahorra el viaje de ida y vuelta antes del destello.
      const expected = sharedSymbol(view.mySymbols, view.baseSymbols);
      const looksRight = expected !== null && expected === symbolId;

      setFeedback({ symbolId, type: looksRight ? "good" : "bad" });
      if (looksRight) {
        vibrate(25);
        sound.correct();
      } else {
        setShake(true);
        vibrate([60, 40, 60]);
        sound.error();
      }

      const res = await play(symbolId);
      let hold = FLASH_MS;

      if (res?.outcome === "penalty") {
        setPenaltyKey((k) => k + 1);
      } else if (res?.outcome === "stale" && looksRight) {
        /*
         * Los dos tocaron el símbolo bueno casi a la vez y el otro llegó
         * primero. Aquí estaba el peor momento de la partida: el destello verde
         * ya había salido —se adelanta a propósito, para que el toque se sienta
         * inmediato— y luego se borraba y no pasaba nada más. Verde y quieto se
         * lee como un juego roto, no como una carrera perdida por un pelo.
         *
         * Así que el verde se CORRIGE a ámbar en vez de desaparecer, y se dice
         * por qué. No cuesta nada —el servidor no cobra castigo por esto— y esa
         * es justamente la parte que había que poder contar.
         */
        setFeedback({ symbolId, type: "late" });
        setShake(false);
        setLateKey((k) => k + 1);
        sound.late();
        hold = LATE_FLASH_MS;
      } else if (res?.outcome === "stale") {
        // Tarde, pero es que además NO era el símbolo. Se borra el rojo, porque
        // castigo no hubo; y no se dice "te ganaron de mano", porque no es
        // verdad: no lo tenías. Consolar con un mérito que no existe enseña mal.
        setFeedback(null);
        setShake(false);
      }

      setTimeout(() => {
        setFeedback(null);
        setShake(false);
      }, hold);
    },
    [view, play]
  );

  const visual = useMemo(
    () =>
      cards.map((c) => ({
        ...c,
        placed: placeMatchCard(code, c.card, c.symbols),
      })),
    [cards, code]
  );

  /**
   * Al acertar, el símbolo común destella en las DOS cartas: es lo que
   * confirma el match. Al fallar, solo en la tuya — la base no tiene la culpa.
   *
   * Y al llegar tarde, también solo en la tuya, por un motivo distinto: la base
   * contra la que acertaste ya no está en pantalla. Pintarle ese símbolo a la
   * que acaba de llegar sería señalar una coincidencia que no existe.
   */
  function flashFor(role: Role): string | null {
    if (!feedback) return null;
    if (feedback.type === "good") return feedback.symbolId;
    return role === "incoming" ? feedback.symbolId : null;
  }

  if (loading && !view) {
    return (
      <section className="arena-card room-state" aria-busy="true">
        <p className="arena-hero-text">{t("match.loading")}</p>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="arena-card arena-hero room-state">
        <h1 className="arena-hero-title">{t("match.gone.title")}</h1>
        <p className="arena-hero-text">
          {error === "not_playing" ? t("match.gone.not_yours") : t("match.gone.text")}
        </p>
        <Link className="arena-cta" href="/arena">
          {t("room.error.cta")}
        </Link>
      </section>
    );
  }

  const startedAt = new Date(view.startsAt).getTime();
  const elapsedMs = Math.max(
    0,
    (view.finishedAt ? new Date(view.finishedAt).getTime() : serverNow()) - startedAt
  );

  if (phase === "finished") {
    return <ArenaMatchOver view={view} elapsedMs={elapsedMs} />;
  }

  if (phase === "countdown") {
    return (
      <>
        <ArenaMatchPlayers you={view.you} rivals={view.rivals} />
        <div className="countdown">
          <div className="countdown-badge" key={count}>
            {count > 0 ? count : t("match.go")}
          </div>
        </div>
        <p className="arena-prize-note">{t("match.countdown.hint")}</p>
      </>
    );
  }

  const cardsLeft = view.you?.cardsLeft ?? 0;

  return (
    <>
      <ArenaMatchPlayers you={view.you} rivals={view.rivals} />

      {failures >= OFFLINE_AFTER && (
        <p className="room-warn" role="status">
          {t("match.you_offline")}
        </p>
      )}

      <div className="play-board match-board">
        <aside className="side-stats">
          <div className="stat-pill">
            <span className="sp-emoji">⏱️</span>
            <span className="sp-value">{(elapsedMs / 1000).toFixed(1)}s</span>
            <span className="sp-label">{t("game.stat.time")}</span>
          </div>
          <button
            type="button"
            className="mute-btn"
            onClick={toggleMuted}
            aria-label={muted ? t("sound.unmute") : t("sound.mute")}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </aside>

        <div className="chain-area">
          <span className="slot-tag slot-tag-base">{t("game.slot.base")}</span>
          <span className="slot-tag slot-tag-mine">{t("game.slot.mine")}</span>
          {cardsLeft > 1 && <div className="deck-stack" />}
          {penaltyKey > 0 && (
            <span key={penaltyKey} className="penalty-float">
              {t("match.penalty")}
            </span>
          )}
          {/* La explicación del ámbar. Flota igual que el castigo pero en el
              otro color, y dice lo que pasó en tres palabras. */}
          {lateKey > 0 && (
            <span key={`late-${lateKey}`} className="late-float">
              {t("match.late")}
            </span>
          )}
          {visual.map((vc) => (
            <div
              key={vc.key}
              className={`chain-card slot-${vc.role} ${
                vc.entry === "above" ? "fresh-above" : "fresh"
              }`}
            >
              <CardView
                symbols={vc.placed}
                flashSymbolId={flashFor(vc.role)}
                flashType={feedback?.type ?? null}
                shake={shake && vc.role === "incoming"}
                disabled={vc.role !== "incoming"}
                onTap={onTap}
              />
            </div>
          ))}
        </div>

        <aside className="side-stats">
          <div className="stat-pill">
            <span className="sp-emoji">🃏</span>
            <span className="sp-value">{cardsLeft}</span>
            <span className="sp-label">{t("game.stat.cards")}</span>
          </div>
          <div className="stat-pill">
            <span className="sp-emoji">🧱</span>
            <span className="sp-value">{view.you?.penalties ?? 0}</span>
            <span className="sp-label">{t("match.stat.penalties")}</span>
          </div>
        </aside>
      </div>

      <button type="button" className="match-quit" onClick={leave}>
        {t("match.quit")}
      </button>
    </>
  );
}
