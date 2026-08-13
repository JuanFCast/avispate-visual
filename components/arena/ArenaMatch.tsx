"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { placeMatchCard, sharedSymbol } from "@/lib/arena-deck";
import { useArenaMatch } from "@/lib/arena-match-client";
import { countdownNumber, matchShellClass, type MatchPhase } from "@/lib/arena-match";
import { boardDiameter, cornerMaxWidth, waistOffset } from "@/lib/arena-board-geometry";
import { useViewportSize } from "@/lib/use-viewport-size";
import { useT } from "@/lib/i18n/client";
import { sound, unlockAudio } from "@/lib/sound";
import CardView from "../CardView";
import ArenaMatchOver from "./ArenaMatchOver";
import ArenaMatchPlayers, { RailChip, matchSlots } from "./ArenaMatchPlayers";

/**
 * Geometría del tablero — ver `lib/arena-board-geometry.ts` y
 * `scripts/verify-arena-board-geometry.ts`.
 *
 * `SHELL_PAD`/`CIRCLE_GAP` son el mínimo técnico, no una fila para meter UI:
 * los jugadores viven en las esquinas curvas y Tomadas/Castigos en el hueco
 * lateral que deja la tangente entre las dos cartas — ninguno de los dos
 * reserva layout. El diámetro real de la carta lo decide el `calc()` de
 * `--card-d` en CSS, no JS: ver el porqué en `lib/use-viewport-size.ts`.
 */
const CIRCLE_GAP = 4;
/*
 * El chip de jugador vive DENTRO de la caja del círculo, nunca fuera de
 * ella: `CORNER_BLEED = 0` es a propósito. Un presupuesto de sangrado hacia
 * afuera de la caja asume margen que puede no existir —el shell solo separa
 * 4px del borde real— y ese fue exactamente el bug: el chip se salía por
 * arriba/abajo del viewport en vez de quedarse en el hueco muerto que la
 * curvatura ya deja adentro.
 */
const CORNER_H = 28;
const CORNER_BLEED = 0;
const CORNER_MIN_W = 44;
const CORNER_MAX_W = 90;
const WAIST_H = 32;
const WAIST_MIN_W = 56;
const WAIST_MAX_W = 110;

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
 * El contenedor de la pantalla. Existe para que TODAS las salidas de este
 * componente pasen por el mismo sitio y ninguna se quede con las clases de otra
 * fase: el candado de scroll del tablero puesto en los resultados fue
 * exactamente ese error. Ver `matchShellClass`.
 */
function MatchShell({
  phase,
  children,
}: {
  phase: MatchPhase | null;
  children: React.ReactNode;
}) {
  return <main className={matchShellClass(phase)}>{children}</main>;
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
  /** El cuadro de "¿seguro?" antes de abandonar. Se puede cancelar. */
  const [quitConfirm, setQuitConfirm] = useState(false);
  /** El intento de abandonar falló (red, ficha vencida) — no es lo normal. */
  const [quitFailed, setQuitFailed] = useState(false);
  /** Solo para derivar el ancho seguro de los overlays — el diámetro de la
      carta no depende de esto, ver el comentario junto a las constantes. */
  const viewport = useViewportSize();

  const shown = useRef<{ base: number | null; mine: number | null }>({
    base: null,
    mine: null,
  });
  const instance = useRef(0);
  const lastCount = useRef<number | null>(null);

  /**
   * Se confirma antes de tocar la red: "no podrás volver" es cierto e
   * irreversible, y un toque de más no puede costar la silla.
   */
  async function handleQuit() {
    setQuitConfirm(false);
    const result = await leave();
    if (!result.ok) {
      setQuitFailed(true);
      setTimeout(() => setQuitFailed(false), 3200);
    }
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
      <MatchShell phase={null}>
        <section className="arena-card room-state" aria-busy="true">
          <p className="arena-hero-text">{t("match.loading")}</p>
        </section>
      </MatchShell>
    );
  }

  if (!view) {
    return (
      <MatchShell phase={null}>
        <section className="arena-card arena-hero room-state">
          <h1 className="arena-hero-title">{t("match.gone.title")}</h1>
          <p className="arena-hero-text">
            {error === "not_playing"
              ? t("match.gone.not_yours")
              : t("match.gone.text")}
          </p>
          <Link className="arena-cta" href="/arena">
            {t("room.error.cta")}
          </Link>
        </section>
      </MatchShell>
    );
  }

  const startedAt = new Date(view.startsAt).getTime();
  const elapsedMs = Math.max(
    0,
    (view.finishedAt ? new Date(view.finishedAt).getTime() : serverNow()) - startedAt
  );

  if (phase === "finished") {
    return (
      <MatchShell phase="finished">
        <ArenaMatchOver view={view} elapsedMs={elapsedMs} />
      </MatchShell>
    );
  }

  /*
   * Abandonaste, pero la mesa tenía más gente: la partida no se acaba por ti
   * solo, sigue entre los demás. No hay tablero que enseñarte —no puedes
   * tocar nada, ya te fuiste— así que aquí termina tu pantalla, no la suya.
   * Si la mesa era de dos, esto nunca se pinta: ahí abandonar SÍ termina la
   * partida y `phase` ya llegó como `"finished"`, arriba.
   */
  if (view.you?.left) {
    return (
      <MatchShell phase={null}>
        <section className="arena-card arena-hero room-state">
          <h1 className="arena-hero-title">{t("match.left.title")}</h1>
          <p className="arena-hero-text">{t("match.left.text")}</p>
          <Link className="arena-cta" href="/arena">
            {t("room.error.cta")}
          </Link>
        </section>
      </MatchShell>
    );
  }

  if (phase === "countdown") {
    return (
      <MatchShell phase="countdown">
        <ArenaMatchPlayers you={view.you} rivals={view.rivals} />
        <div className="countdown">
          <div className="countdown-badge" key={count}>
            {count > 0 ? count : t("match.go")}
          </div>
        </div>
        <p className="arena-prize-note">{t("match.countdown.hint")}</p>
      </MatchShell>
    );
  }

  const cardsLeft = view.you?.cardsLeft ?? 0;
  const slots = matchSlots(view.you, view.rivals);

  /*
   * `--card-d` lo decide el `calc()` de CSS, no esto: acá solo se deriva,
   * con el MISMO `boardDiameter`, cuánto pueden medir los overlays sin
   * pisar el círculo. `jsPad` (8px) es a propósito un poco más generoso que
   * el mínimo real de CSS (4px + safe-area) — si el viewport medido en JS
   * llega ligeramente optimista, el overlay sale un pelo más chico de lo
   * estrictamente posible, nunca más grande de lo seguro.
   */
  const jsPad = 8;
  const geomD =
    viewport.width > 0
      ? boardDiameter(
          Math.max(1, viewport.width - jsPad * 2),
          Math.max(1, viewport.height - jsPad * 2),
          CIRCLE_GAP
        )
      : 260;
  const geomR = geomD / 2;
  const cornerW = cornerMaxWidth(geomR, CORNER_H, CORNER_BLEED, CORNER_MIN_W, CORNER_MAX_W);
  const waistOff = waistOffset(geomR, WAIST_H);
  const waistMaxW = Math.max(WAIST_MIN_W, Math.min(WAIST_MAX_W, geomR - waistOff));

  const overlayVars = {
    "--corner-w": `${cornerW}px`,
    "--corner-h": `${CORNER_H}px`,
    "--waist-offset": `${waistOff}px`,
    "--waist-max-w": `${waistMaxW}px`,
  } as CSSProperties;

  return (
    <MatchShell phase="playing">
      {/* `room-warn-overlay`: position absolute, no le resta alto a nada —
          ni siquiera un aviso raro de conexión puede achicar el círculo. */}
      {failures >= OFFLINE_AFTER && (
        <p className="room-warn room-warn-overlay" role="status">
          {t("match.you_offline")}
        </p>
      )}
      {quitFailed && (
        <p className="room-warn room-warn-overlay" role="status">
          {t("match.quit.failed")}
        </p>
      )}

      {/*
        Todo lo que no es círculo vive en `position: absolute` DENTRO de
        `.chain-area` — igual que ya vivían `.slot-tag`/`.deck-stack`/etc—,
        así que se ancla a la caja EXACTA de las dos cartas (`width:
        var(--card-d)`, `height: calc(var(--card-d)*2 + var(--card-gap))`)
        sin ningún cálculo de centrado aparte. Ninguno de estos overlays
        entra en la cuenta de `--card-d`: los jugadores se anclan a las
        cuatro esquinas curvas de cada círculo; Tomadas/Castigos y la salida
        usan el hueco lateral que deja la curvatura justo donde BASE y TU
        CARTA casi se tocan (`--circle-gap: 4px`, el mínimo técnico, no una
        fila para meter UI). Ver `lib/arena-board-geometry.ts`.
      */}
      <div className="match-stage">
        <div className="chain-area" style={overlayVars}>
          <span className="chain-label chain-label-base">{t("game.slot.base")}</span>
          <span className="chain-label chain-label-mine">{t("game.slot.mine")}</span>
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

          {/* Posición fija por asiento: rival 1 arriba-izq, rival 2
              arriba-der, rival 3 abajo-izq, tú siempre abajo-der. La
              esquina sin jugador se queda vacía — nada se recentra. */}
          <div className="corner corner-base-left">
            {slots.baseLeft && <RailChip key={slots.baseLeft.profileId} player={slots.baseLeft} />}
          </div>
          <div className="corner corner-base-right">
            {slots.baseRight && (
              <RailChip key={slots.baseRight.profileId} player={slots.baseRight} />
            )}
          </div>
          <div className="corner corner-mine-left">
            {slots.mineLeft && <RailChip key={slots.mineLeft.profileId} player={slots.mineLeft} />}
          </div>
          <div className="corner corner-mine-right">
            {slots.mineRight && (
              <RailChip key={slots.mineRight.profileId} player={slots.mineRight} />
            )}
          </div>

          <div className="waist waist-left">
            <div className="waist-pill">
              <span className="sp-emoji">✋</span>
              <span className="sp-value">{view.you?.correct ?? 0}</span>
              <span className="sp-label">{t("match.stat.taken")}</span>
            </div>
          </div>
          <div className="waist waist-right">
            <div className="waist-pill">
              <span className="sp-emoji">🧱</span>
              <span className="sp-value">{view.you?.penalties ?? 0}</span>
              <span className="sp-label">{t("match.stat.penalties")}</span>
            </div>
          </div>
          {/* Mínimo a propósito: un toque abre la confirmación, nada de
              texto ni de gesto sostenido ocupando el punto donde se tocan
              las cartas. */}
          <button
            type="button"
            className="waist-exit"
            onClick={() => setQuitConfirm(true)}
            aria-label={t("match.quit")}
          >
            🏳️
          </button>
        </div>
      </div>

      {/* "No podrás volver" es cierto e irreversible, así que se confirma
          aparte del tablero — un toque de más aquí no puede costar la silla. */}
      {quitConfirm && (
        <div className="lobby-modal-backdrop" onClick={() => setQuitConfirm(false)}>
          <div
            className="lobby-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="quit-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="quit-confirm-title" className="lobby-modal-title">
              {t("match.quit.confirm.title")}
            </h2>
            <p className="lobby-modal-text">{t("match.quit.confirm.text")}</p>
            <button type="button" className="arena-cta" onClick={() => setQuitConfirm(false)}>
              {t("match.quit.confirm.stay")}
            </button>
            <button type="button" className="match-quit-confirm-go" onClick={handleQuit}>
              {t("match.quit.confirm.go")}
            </button>
          </div>
        </div>
      )}
    </MatchShell>
  );
}
