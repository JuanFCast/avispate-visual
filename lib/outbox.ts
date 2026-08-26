"use client";

import { postWithRetry, type SendOutcome } from "./submit.ts";

/**
 * Bandeja de salida en el dispositivo.
 *
 * Lo que está en juego es dinero: cuando el contrato cobra la entrada (o gasta
 * la jugada gratis del día), eso ya pasó y no se deshace. Si el envío al
 * servidor viviera solo en memoria, cerrar Chrome en el momento equivocado lo
 * borraría para siempre y el jugador se quedaría sin ranking y sin plata.
 *
 * Por eso todo envío crítico se ESCRIBE PRIMERO en `localStorage`, de forma
 * síncrona, y solo se borra cuando el servidor confirma que lo recibió (o lo
 * rechaza de manera definitiva). Lo que quede pendiente se reenvía al volver a
 * abrir la app. Los dos endpoints son idempotentes, así que reenviar de más no
 * duplica nada.
 */

const KEY = "avispateOutbox_v1";

/**
 * Pasado este tiempo un envío ya no sirve: el ranking es por ronda diaria y
 * una marca de anteayer no entra en ninguna. Se descarta para no arrastrar
 * basura en el dispositivo para siempre.
 */
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Envío que retiene al jugador (el recibo de la jugada recién pagada, antes
 * del 3, 2, 1). ~15 s en total: en la práctica el servidor responde en menos
 * de un segundo, así que este margen solo cubre un nodo que va detrás. Más
 * espera no rescata nada y convierte el botón en una pantalla de carga.
 */
export const BLOCKING_DELAYS = [1000, 2000, 4000, 8000] as const;

/** Reenvío de fondo (al abrir la app o al volver la conexión). Sin prisa. */
export const BACKGROUND_DELAYS = [2000, 6000] as const;

export interface OutboxItem {
  /** Estable y único por envío: `play:<txHash>` o `score:<clientGameId>`. */
  id: string;
  url: string;
  body: unknown;
  createdAt: number;
}

function read(): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const fresh = (parsed as OutboxItem[]).filter(
      (it) => it && typeof it.id === "string" && Date.now() - it.createdAt < MAX_AGE_MS
    );
    return fresh;
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // localStorage lleno o bloqueado (modo privado). El envío en curso sigue
    // funcionando; lo que se pierde es la red de seguridad ante un cierre.
  }
  // Se avisa SIEMPRE, incluso si el guardado falló: quien escucha vuelve a
  // leer la bandeja y decide con lo que hay, no con lo que creíamos escribir.
  notify();
}

/**
 * ── Quién está mirando la bandeja ──────────────────────────────────────────
 *
 * Existe por un fallo concreto y reproducible: el candado del segundo cobro se
 * pone al ABRIR (`GameShell` lee `pendingPlay()` al montar) y el reenvío de
 * fondo (`OutboxBridge`) vacía la bandeja un segundo después. Los efectos del
 * hijo corren antes que los del padre, así que el candado ganaba SIEMPRE la
 * carrera y nadie volvía a apagarlo: el botón seguía ofreciendo "terminar de
 * registrar" una jugada que ya estaba registrada, y solo tocarlo lo limpiaba.
 *
 * Esto no decide nada —la regla vive en `decidePendingBlockRelease`, en
 * `pay-guard.ts`, para poder correrla sin navegador—: solo avisa de que la
 * bandeja cambió, y quien escucha vuelve a leerla.
 */
type OutboxListener = () => void;

const listeners = new Set<OutboxListener>();

function notify(): void {
  // Copia: un oyente puede darse de baja dentro de su propia llamada.
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
      // Un oyente roto NO puede tumbar a los demás ni, sobre todo, salir por
      // `enqueue`: ahí arriba está el recibo de una jugada recién cobrada,
      // guardándose sin un solo `await` de por medio. Avisar es un extra;
      // guardar es la razón de ser de este archivo.
    }
  }
}

/**
 * Cambios hechos en OTRA pestaña. El mismo `localStorage`, la misma jugada: si
 * allí se registró, aquí tampoco hay ya nada que terminar. `key === null` es
 * un `clear()` entero, que también nos toca.
 */
function onStorage(ev: StorageEvent): void {
  if (ev.key !== null && ev.key !== KEY) return;
  notify();
}

/**
 * Escucha los cambios de la bandeja. Devuelve la baja.
 *
 * UN solo oyente de `storage` para todos los suscriptores, puesto con el
 * primero y retirado con el último — simétrico a propósito: acumular oyentes
 * que contestan con estado viejo ya costó un día entero en `embedded-wallet`.
 */
export function subscribeOutbox(fn: OutboxListener): () => void {
  listeners.add(fn);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/**
 * Guarda un envío pendiente. SÍNCRONO a propósito: se llama antes de cualquier
 * `await`, para que un cierre de pestaña en el instante siguiente ya lo
 * encuentre escrito. Si el mismo `id` ya estaba, se conserva el original (los
 * dos son el mismo envío y el servidor los trata igual).
 */
export function enqueue(id: string, url: string, body: unknown): OutboxItem {
  const items = read();
  const existing = items.find((it) => it.id === id);
  if (existing) return existing;

  const item: OutboxItem = { id, url, body, createdAt: Date.now() };
  write(items.concat(item));
  return item;
}

/** Saca un envío de la bandeja (entregado o rechazado sin remedio). */
export function drop(id: string): void {
  write(read().filter((it) => it.id !== id));
}

/** Envíos que siguen pendientes en este dispositivo. */
export function pending(): OutboxItem[] {
  return read();
}

/**
 * La jugada YA PAGADA que todavía no consta en el servidor, si la hay.
 *
 * Es el candado contra el segundo cobro: mientras esto devuelva algo, la
 * pantalla no puede ofrecer "jugar" —volvería a llamar al contrato y cobraría
 * otra vez, y encima como paga, porque la gratis del día ya se consumió—. Solo
 * puede ofrecer terminar de registrar la que ya se pagó.
 *
 * Ojo con su alcance: esto vive en el `localStorage` de ESTE navegador. Otra
 * pestaña lo ve porque comparten almacenamiento, pero otro dispositivo no.
 */
export function pendingPlay(): {
  txHash: string;
  player: string;
  deckSize: number;
} | null {
  for (const item of read()) {
    if (!item.id.startsWith("play:")) continue;
    const body = item.body as
      | { txHash?: unknown; player?: unknown; deckSize?: unknown }
      | null;
    if (
      typeof body?.txHash === "string" &&
      typeof body?.player === "string" &&
      typeof body?.deckSize === "number"
    ) {
      return {
        txHash: body.txHash,
        player: body.player,
        deckSize: body.deckSize,
      };
    }
  }
  return null;
}

/**
 * Intenta entregar un envío. Solo lo borra de la bandeja cuando el servidor
 * responde: si queda en "retry", se queda guardado para el próximo arranque.
 */
export async function deliver(
  item: OutboxItem,
  delays: readonly number[] = BACKGROUND_DELAYS
): Promise<SendOutcome> {
  const outcome = await postWithRetry(item.url, item.body, delays);
  if (outcome.result !== "retry") drop(item.id);
  return outcome;
}

/**
 * Corrige el pagador de una jugada pendiente y la deja lista para reenviarse.
 *
 * Solo se usa cuando la cadena dijo que pagó otra dirección Y la persona ya
 * conectó esa misma wallet: es ELLA quien reconcilia su identidad, no nosotros
 * adivinando. Sin esa confirmación el envío se queda pendiente para siempre, y
 * está bien que así sea: mientras siga pendiente no puede haber un segundo
 * cobro.
 */
export function repairPendingPlayer(txHash: string, payer: string): void {
  const items = read();
  const id = `play:${txHash}`;
  const next = items.map((it) =>
    it.id === id && it.body && typeof it.body === "object"
      ? { ...it, body: { ...(it.body as object), player: payer } }
      : it
  );
  write(next);
}

/** Evita que dos disparos a la vez (montaje + evento `online`) se pisen. */
let flushing = false;

/**
 * Reenvía todo lo pendiente. Devuelve cuántos envíos ACEPTÓ el servidor, para
 * que quien llame decida si tiene que refrescar algo (el ranking, por ejemplo).
 */
export async function flushOutbox(
  delays: readonly number[] = BACKGROUND_DELAYS
): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  try {
    let delivered = 0;
    // En orden de llegada: el recibo de una jugada antes que su resultado.
    for (const item of pending()) {
      const outcome = await deliver(item, delays);
      if (outcome.result === "ok") delivered++;
    }
    return delivered;
  } finally {
    flushing = false;
  }
}
