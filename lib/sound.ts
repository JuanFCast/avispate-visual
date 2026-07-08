// Efectos de sonido generados con WebAudio: sin archivos externos, todo son
// osciladores cortos con envolvente. Se silencia con persistencia local.

const MUTE_KEY = "visualRushMuted_v1";

let ctx: AudioContext | null = null;
let muted = false;
let mutedLoaded = false;

function loadMuted() {
  if (mutedLoaded || typeof window === "undefined") return;
  mutedLoaded = true;
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    muted = false;
  }
}

export function isMuted(): boolean {
  loadMuted();
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  mutedLoaded = true;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // sin persistencia, el toggle sigue funcionando en la sesión
  }
}

/** Crea/reanuda el AudioContext. Llamar desde un gesto del usuario. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
}

interface ToneOptions {
  type?: OscillatorType;
  duration?: number;
  delay?: number;
  volume?: number;
  slideTo?: number;
}

function tone(
  freq: number,
  { type = "sine", duration = 0.15, delay = 0, volume = 0.15, slideTo }: ToneOptions = {}
) {
  loadMuted();
  if (muted || !ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sound = {
  /** Tick de la cuenta regresiva. */
  tick() {
    tone(600, { type: "square", duration: 0.07, volume: 0.06 });
  },
  /** ¡Ya! — arranca la partida. */
  go() {
    tone(880, { type: "square", duration: 0.18, volume: 0.1 });
  },
  /** Acierto: pop brillante de dos notas. */
  correct() {
    tone(660, { type: "triangle", duration: 0.09, volume: 0.16 });
    tone(990, { type: "triangle", duration: 0.13, volume: 0.16, delay: 0.07 });
  },
  /** Carta nueva saliendo del mazo: swish ascendente suave. */
  deal(delay = 0) {
    tone(240, { type: "sine", duration: 0.16, volume: 0.06, delay, slideTo: 560 });
  },
  /** Error: zumbido grave descendente. */
  error() {
    tone(180, { type: "sawtooth", duration: 0.22, volume: 0.1, slideTo: 110 });
  },
  /** Fin de partida: arpegio de cierre. */
  finish() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, { type: "triangle", duration: 0.22, volume: 0.13, delay: i * 0.12 })
    );
  },
  /** Nuevo récord: fanfarria más larga. */
  record() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(f, { type: "triangle", duration: 0.26, volume: 0.15, delay: i * 0.11 })
    );
  },
};
