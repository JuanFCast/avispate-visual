"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChainCard, PlacedSymbol } from "@/lib/game";
import { useT } from "@/lib/i18n/client";
import CardView from "./CardView";

/* ---------------------------------------------------------------------- */
/* Primera visita: clave versionada en localStorage.                       */
/* ---------------------------------------------------------------------- */

const STORAGE_KEY = "avispate:how-to-play:v1";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Con localStorage bloqueado se asume visto: nunca un overlay en cada visita. */
function readSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Sin persistencia, el cierre sigue funcionando dentro de esta sesión.
  }
  listeners.forEach((l) => l());
}

/**
 * Apertura del tutorial. En SSR el snapshot es "visto" para evitar flash e
 * hydration mismatch; el cliente corrige justo después de hidratar. replay()
 * reabre aunque la clave exista (el componente remonta y vuelve al paso 1).
 *
 * `resolved` indica que localStorage ya se leyó en el cliente: mientras sea
 * falso, la decisión primera-visita/lobby aún no se conoce y el llamador debe
 * mostrar solo el fondo de marca (ni "Cargando…", ni acceso, ni lobby).
 */
export function useHowToPlay() {
  const seen = useSyncExternalStore(subscribe, readSeen, () => true);
  // false en SSR/hidratación, true apenas el cliente toma el control.
  const resolved = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const [replaying, setReplaying] = useState(false);

  const close = useCallback(() => {
    markSeen();
    setReplaying(false);
  }, []);

  const replay = useCallback(() => setReplaying(true), []);

  return { open: replaying || !seen, close, replay, resolved };
}

/* ---------------------------------------------------------------------- */
/* Cartas deterministas del ejemplo: nunca pasan por lib/game.             */
/* A y B comparten solo la manzana; B y C comparten solo el carro.         */
/* ---------------------------------------------------------------------- */

function placeFixed(ids: string[], angleOffset: number): PlacedSymbol[] {
  const ringCount = ids.length - 1;
  const placed: PlacedSymbol[] = [
    { symbolId: ids[0], x: 50, y: 50, rotation: -12, scale: 1.05 },
  ];
  for (let i = 0; i < ringCount; i++) {
    const angle = ((angleOffset + (360 / ringCount) * i) * Math.PI) / 180;
    placed.push({
      symbolId: ids[i + 1],
      x: 50 + Math.cos(angle) * 33,
      y: 50 + Math.sin(angle) * 33,
      rotation: ((i * 53) % 70) - 35,
      scale: 0.9 + ((i * 29) % 40) / 100,
    });
  }
  return placed;
}

const CARD_A: ChainCard = {
  id: -1,
  symbols: placeFixed(
    ["dice", "apple", "sun", "frog", "whale", "key", "pizza", "balloon"],
    10
  ),
};

const CARD_B: ChainCard = {
  id: -2,
  symbols: placeFixed(
    ["gift", "apple", "strawberry", "car", "crab", "magnet", "octopus", "bike"],
    210
  ),
};

const CARD_C: ChainCard = {
  id: -3,
  symbols: placeFixed(
    ["lock", "car", "banana", "moon", "turtle", "dolphin", "guitar", "rocket"],
    120
  ),
};

const TRY_TARGET = "apple";
const MOTION_TARGET = "car";
const APPLE_IN_B = CARD_B.symbols.find((p) => p.symbolId === TRY_TARGET)!;

const STEP_COUNT = 4;
const HINT_DELAY_MS = 2500;
const ADVANCE_DELAY_MS = 350;
const SHAKE_MS = 300;
/* La demo respira un instante antes de mover para que se lea el acierto. */
const MOTION_START_MS = 400;
const MOTION_HIGHLIGHT_MS = MOTION_START_MS + 650;

function noop() {}

/* ---------------------------------------------------------------------- */
/* Overlay                                                                 */
/* ---------------------------------------------------------------------- */

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(0);

  // Paso 2: práctica.
  const [matched, setMatched] = useState(false);
  const [wrongId, setWrongId] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [message, setMessage] = useState("");

  // Paso 3: demostración del movimiento.
  const [motionKey, setMotionKey] = useState(0);
  const [motionMoved, setMotionMoved] = useState(false);
  const [motionDone, setMotionDone] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const timersRef = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  // Cerrar en plena animación no debe dejar timeouts tocando estado.
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Foco al abrir; al cerrar vuelve al enlace "Ver cómo se juega" del lobby.
  useEffect(() => {
    skipRef.current?.focus();
    return () => {
      document.querySelector<HTMLElement>("[data-howto-trigger]")?.focus();
    };
  }, []);

  // Bloquear el scroll del fondo mientras el overlay esté abierto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Teclado: Escape cierra, Tab queda dentro del diálogo y las flechas solo
  // navegan en pasos no interactivos (la práctica avanza con el acierto).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const focusables = Array.from(
          overlay.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], [tabindex]'
          )
        ).filter((el) => el.tabIndex !== -1);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (indexRef.current === 1) return;
      if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(i + 1, STEP_COUNT - 1));
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Práctica: estado limpio al entrar y pista tras 2.5 s sin respuesta.
  useEffect(() => {
    if (index !== 1) return;
    setMatched(false);
    setWrongId(null);
    setHintVisible(false);
    setMessage("");
    const timer = window.setTimeout(() => {
      setHintVisible(true);
      setMessage((m) => m || t("howto.s2.hint"));
    }, HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [index, t]);

  // Demo de movimiento: se reproduce una vez por entrada o repetición.
  useEffect(() => {
    if (index !== 2) return;
    setMotionMoved(false);
    setMotionDone(false);
    const t1 = window.setTimeout(() => setMotionMoved(true), MOTION_START_MS);
    const t2 = window.setTimeout(() => setMotionDone(true), MOTION_HIGHLIGHT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [index, motionKey]);

  function handleTryTap(symbolId: string) {
    if (matched) return; // doble toque rápido: un único avance
    if (symbolId === TRY_TARGET) {
      setMatched(true);
      setWrongId(null);
      setHintVisible(false);
      setMessage(t("howto.s2.right"));
      later(() => setIndex(2), ADVANCE_DELAY_MS);
    } else {
      setWrongId(symbolId);
      setMessage(t("howto.s2.wrong"));
      later(() => setWrongId((w) => (w === symbolId ? null : w)), SHAKE_MS);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="howto-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("howto.aria")}
    >
      <div className="howto-inner">
        <header className="howto-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-avispate.webp" alt="" className="howto-logo" />
          <div
            className="howto-progress"
            aria-label={t("howto.progress", { n: index + 1 })}
          >
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span
                key={i}
                className={`howto-pill${i === index ? " active" : ""}`}
              />
            ))}
          </div>
          <button
            ref={skipRef}
            type="button"
            className="howto-skip"
            onClick={onClose}
          >
            {t("howto.skip")}
          </button>
        </header>

        <div className="howto-body">
          {index === 0 && (
            <section className="howto-step" key="idea">
              <span className="howto-kicker">{t("howto.kicker", { n: 1 })}</span>
              <h2 className="howto-title">{t("howto.s1.title")}</h2>
              <p className="howto-text">{t("howto.s1.text")}</p>
              <div
                className="howto-minis"
                role="img"
                aria-label={t("howto.s1.aria")}
              >
                <div className="howto-mini">
                  <span style={{ left: "50%", top: "24%" }}>☀️</span>
                  <span style={{ left: "26%", top: "60%" }}>🐸</span>
                  <span style={{ left: "74%", top: "62%" }}>🐳</span>
                  <span
                    className="howto-mini-match"
                    style={{ left: "51%", top: "52%" }}
                  >
                    🍎
                  </span>
                </div>
                <div className="howto-mini mine">
                  <span style={{ left: "50%", top: "24%" }}>🍓</span>
                  <span style={{ left: "28%", top: "62%" }}>🚗</span>
                  <span style={{ left: "74%", top: "60%" }}>🦀</span>
                  <span
                    className="howto-mini-match"
                    style={{ left: "50%", top: "50%" }}
                  >
                    🍎
                  </span>
                </div>
              </div>
            </section>
          )}

          {index === 1 && (
            <section className="howto-step" key="try">
              <span className="howto-kicker">{t("howto.kicker", { n: 2 })}</span>
              <h2 className="howto-title">{t("howto.s2.title")}</h2>
              <p className="howto-text">{t("howto.s2.text")}</p>
              <div className="chain-area">
                <span className="slot-tag slot-tag-base">
                  {t("game.slot.base")}
                </span>
                <span className="slot-tag slot-tag-mine">
                  {t("game.slot.mine")}
                </span>
                <div
                  className="chain-card slot-base"
                  role="img"
                  aria-label={t("howto.s2.base_aria")}
                >
                  <CardView
                    symbols={CARD_A.symbols}
                    flashSymbolId={matched ? TRY_TARGET : null}
                    flashType={matched ? "good" : null}
                    shake={false}
                    disabled
                    onTap={noop}
                  />
                </div>
                <div
                  className="chain-card slot-incoming"
                  role="group"
                  aria-label={t("howto.s2.mine_aria")}
                >
                  {hintVisible && !matched && (
                    <span
                      className="howto-halo"
                      style={{
                        left: `${APPLE_IN_B.x}%`,
                        top: `${APPLE_IN_B.y}%`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <CardView
                    symbols={CARD_B.symbols}
                    flashSymbolId={matched ? TRY_TARGET : wrongId}
                    flashType={matched ? "good" : wrongId ? "bad" : null}
                    shake={wrongId !== null}
                    disabled={matched}
                    onTap={handleTryTap}
                  />
                </div>
              </div>
            </section>
          )}

          {index === 2 && (
            <section className="howto-step" key="motion">
              <span className="howto-kicker">{t("howto.kicker", { n: 3 })}</span>
              <h2 className="howto-title">{t("howto.s3.title")}</h2>
              <p className="howto-text">{t("howto.s3.text")}</p>
              <div
                key={motionKey}
                className="chain-area"
                role="img"
                aria-label={t("howto.s3.aria")}
              >
                <span className="slot-tag slot-tag-base">
                  {t("game.slot.base")}
                </span>
                <span className="slot-tag slot-tag-mine">
                  {t("game.slot.mine")}
                </span>
                <div
                  className={`chain-card ${motionMoved ? "slot-exiting" : "slot-base"}`}
                >
                  <CardView
                    symbols={CARD_A.symbols}
                    flashSymbolId={motionMoved ? null : TRY_TARGET}
                    flashType="good"
                    shake={false}
                    disabled
                    onTap={noop}
                  />
                </div>
                <div
                  className={`chain-card ${motionMoved ? "slot-base" : "slot-incoming"}`}
                >
                  <CardView
                    symbols={CARD_B.symbols}
                    flashSymbolId={
                      motionDone
                        ? MOTION_TARGET
                        : motionMoved
                          ? null
                          : TRY_TARGET
                    }
                    flashType="good"
                    shake={false}
                    disabled
                    onTap={noop}
                  />
                </div>
                {motionMoved && (
                  <>
                    <span className="howto-trail" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <div className="chain-card slot-incoming fresh">
                      <CardView
                        symbols={CARD_C.symbols}
                        flashSymbolId={motionDone ? MOTION_TARGET : null}
                        flashType="good"
                        shake={false}
                        disabled
                        onTap={noop}
                      />
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {index === 3 && (
            <section className="howto-step" key="ready">
              <span className="howto-kicker">{t("howto.kicker", { n: 4 })}</span>
              <h2 className="howto-title">{t("howto.s4.title")}</h2>
              <p className="howto-text">{t("howto.s4.text")}</p>
              <div className="howto-chips">
                <span className="howto-chip">{t("howto.s4.chip1")}</span>
                <span className="howto-chip">{t("howto.s4.chip2")}</span>
                <span className="howto-chip">{t("howto.s4.chip3")}</span>
              </div>
              <p className="howto-note">{t("howto.s4.note")}</p>
            </section>
          )}
        </div>

        <div className="howto-cta">
          {index === 0 && (
            <button
              type="button"
              className="btn-primary howto-btn"
              onClick={() => setIndex(1)}
            >
              {t("howto.show")}
            </button>
          )}
          {index === 1 && (
            <p className="howto-feedback" aria-live="polite">
              {message}
            </p>
          )}
          {index === 2 && (
            <>
              <button
                type="button"
                className="btn-primary howto-btn"
                onClick={() => setIndex(3)}
              >
                {t("common.next")}
              </button>
              <button
                type="button"
                className="howto-again"
                onClick={() => setMotionKey((k) => k + 1)}
              >
                {t("howto.again")}
              </button>
            </>
          )}
          {index === 3 && (
            <button
              type="button"
              className="btn-primary howto-btn"
              onClick={onClose}
            >
              {t("howto.play")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
