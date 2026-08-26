// El candado del segundo cobro se retira SOLO cuando desaparece su motivo.
//
// El fallo que cierra este verificador (reportado por Juan el 2026-08-26):
// abrir la app y encontrarse "Terminar de registrar" sobre una jugada que el
// servidor YA tenía. `GameShell` pone el candado al montar leyendo la bandeja;
// `OutboxBridge`, que vive en los providers, la vacía un instante después. Los
// efectos del hijo corren antes que los del padre, así que el candado ganaba
// siempre la carrera y nadie lo apagaba.
//
// Aquí no se simula el arreglo: se corre. La bandeja es la de verdad
// (`lib/outbox.ts`, con un `localStorage` y un `fetch` de mentira debajo), la
// regla es la de verdad (`decidePendingBlockRelease`) y el botón lo decide
// `decideLobbyCta`. La "pantalla" de abajo hace exactamente lo que hace
// `GameShell`: leer al montar, suscribirse, y no tocar nada más.
//
// Se recorren las cuatro combinaciones que pidió Juan —MiniPay y Rabby, jugada
// gratis y pagada— y, sobre todo, los casos en los que el candado NO se puede
// retirar: mientras quede una jugada pagada sin registrar, el botón no puede
// volver a ofrecer jugar. Eso es lo que impide cobrar dos veces.
//
// Correr: node scripts/verify-pending-release.ts

/* ── Un navegador de mentira, antes de tocar la bandeja ──────────────────── */

type Oyente = (ev: { key: string | null }) => void;

const almacen = new Map<string, string>();
const oyentesStorage = new Set<Oyente>();

const localStorageFalso = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => {
    almacen.set(k, v);
  },
  removeItem: (k: string) => {
    almacen.delete(k);
  },
};

(globalThis as Record<string, unknown>).window = {
  localStorage: localStorageFalso,
  addEventListener: (tipo: string, fn: Oyente) => {
    if (tipo === "storage") oyentesStorage.add(fn);
  },
  removeEventListener: (tipo: string, fn: Oyente) => {
    if (tipo === "storage") oyentesStorage.delete(fn);
  },
};

/** Lo que vería ESTA pestaña si otra registrara la jugada y vaciara la bandeja. */
function otraPestanaVaciaLaBandeja(): void {
  almacen.delete("avispateOutbox_v1");
  for (const fn of Array.from(oyentesStorage)) fn({ key: "avispateOutbox_v1" });
}

/** Respuesta del servidor para el siguiente POST a /api/plays. */
let respuesta: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true, seed: "s-1" },
};

let llamadas: string[] = [];

(globalThis as Record<string, unknown>).fetch = async (url: string) => {
  llamadas.push(url);
  return {
    ok: respuesta.status >= 200 && respuesta.status < 300,
    status: respuesta.status,
    json: async () => respuesta.body,
  };
};

const { enqueue, flushOutbox, pending, pendingPlay, subscribeOutbox } =
  await import("../lib/outbox.ts");
const { decidePendingBlockRelease, decidePlayStart } = await import(
  "../lib/pay-guard.ts"
);
const { decideLobbyCta } = await import("../lib/lobby-cta.ts");
import type { LobbyCtaInput } from "../lib/lobby-cta.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

function limpiar(): void {
  almacen.clear();
  llamadas = [];
  respuesta = { status: 200, body: { ok: true, seed: "s-1" } };
}

/* ── La pantalla, con lo justo: es lo que hace `GameShell` ───────────────── */

type Aviso = { kind: string } | null;

class Pantalla {
  aviso: Aviso = null;
  paying = false;
  private baja: (() => void) | null = null;

  /** El efecto de montaje: leer la bandeja y poner el candado si hay algo. */
  montar(): void {
    const left = pendingPlay();
    if (left) this.aviso = { kind: "resume_pending" };
    const revisar = () => {
      if (
        decidePendingBlockRelease({
          blockKind: this.aviso?.kind ?? null,
          pending: pendingPlay(),
          paying: this.paying,
        })
      ) {
        this.aviso = null;
      }
    };
    revisar();
    this.baja = subscribeOutbox(revisar);
  }

  desmontar(): void {
    this.baja?.();
    this.baja = null;
  }
}

/** Una jugada pagada (o gratis) que se quedó sin registrar en el dispositivo. */
function jugadaPendiente(player: string, deckSize: number): void {
  const txHash = `0x${"ab".repeat(32)}`;
  enqueue(`play:${txHash}`, "/api/plays", {
    txHash,
    player,
    deckSize,
    alias: "PipeRabby",
  });
}

/* ── El botón, con todo lo demás en verde ────────────────────────────────── */

const SANO: LobbyCtaInput = {
  blockedByPending: false,
  profileReady: true,
  authenticated: true,
  profileLoading: false,
  profileFailed: false,
  profileAlias: "PipeRabby",
  walletConnected: true,
  walletReconnecting: false,
  embeddedStatus: "idle",
  inMiniPay: false,
  canOpenConnectModal: true,
  walletAliasReady: true,
  walletAlias: "PipeRabby",
  entitlementReady: true,
  freeForDeck: false,
};

function boton(p: Pantalla, extra: Partial<LobbyCtaInput>) {
  return decideLobbyCta({
    ...SANO,
    ...extra,
    // Exactamente lo que calcula `HomeLobby`.
    blockedByPending:
      p.aviso?.kind === "resume_pending" || p.aviso?.kind === "payer_mismatch",
  });
}

/** Las cuatro combinaciones que hay que cubrir. */
const ENTORNOS = [
  {
    nombre: "MiniPay",
    // La inyectada del teléfono. En MiniPay NO hay cerrar sesión: un aviso
    // pegado aquí no tenía salida desde la app.
    player: "0xcb14efdd0b8d3f0c3c2f0d0e0f1a2b3c4d5e6f70",
    cta: {
      inMiniPay: true,
      canOpenConnectModal: false,
    } as Partial<LobbyCtaInput>,
  },
  {
    nombre: "Rabby",
    player: "0x46d5000000000000000000000000000000008c18",
    cta: { inMiniPay: false } as Partial<LobbyCtaInput>,
  },
] as const;

const MODOS = [
  { nombre: "gratis", freeForDeck: true, label: "cta.free.label" },
  { nombre: "pagada", freeForDeck: false, label: "cta.paid.label" },
] as const;

/* ── 1. El fallo, en las cuatro combinaciones ────────────────────────────── */

console.log(
  "\n— 1. El reenvío de fondo registra la jugada: el aviso se cae solo —\n"
);

for (const entorno of ENTORNOS) {
  for (const modo of MODOS) {
    limpiar();
    jugadaPendiente(entorno.player, modo.nombre === "gratis" ? 10 : 20);

    const p = new Pantalla();
    p.montar(); // ← el candado gana la carrera, como siempre

    const antes = p.aviso?.kind;
    const ctaAntes = boton(p, { ...entorno.cta, freeForDeck: modo.freeForDeck });

    // Y ahora `OutboxBridge`, un instante después. Sin reintentos: aquí se
    // prueba quién apaga el aviso, no cuántas veces se insiste.
    const entregadas = await flushOutbox([]);

    ok(
      `${entorno.nombre} · ${modo.nombre} · el candado se pone al abrir`,
      antes === "resume_pending" && ctaAntes.reason === "pending",
      `aviso=${antes} cta=${JSON.stringify(ctaAntes)}`
    );
    ok(
      `${entorno.nombre} · ${modo.nombre} · la jugada entra y la bandeja queda vacía`,
      entregadas === 1 && pending().length === 0 && llamadas[0] === "/api/plays",
      `entregadas=${entregadas} bandeja=${JSON.stringify(pending())}`
    );
    ok(
      `${entorno.nombre} · ${modo.nombre} · el aviso se retira SIN tocar nada`,
      p.aviso === null,
      `aviso=${JSON.stringify(p.aviso)}`
    );

    const ctaDespues = boton(p, {
      ...entorno.cta,
      freeForDeck: modo.freeForDeck,
    });
    ok(
      `${entorno.nombre} · ${modo.nombre} · el botón vuelve a "${modo.nombre}"`,
      ctaDespues.action === "start" &&
        ctaDespues.label === modo.label &&
        !ctaDespues.disabled,
      JSON.stringify(ctaDespues)
    );
    p.desmontar();
  }
}

/* ── 2. Lo que NO puede pasar: que se suelte con dinero sin registrar ────── */

console.log("\n— 2. Pendientes de verdad: el candado no se mueve —\n");

for (const entorno of ENTORNOS) {
  for (const modo of MODOS) {
    // 2a. El servidor sigue caído.
    limpiar();
    respuesta = { status: 500, body: { error: "server_error" } };
    jugadaPendiente(entorno.player, 15);
    const p = new Pantalla();
    p.montar();
    await flushOutbox([]);
    const cta = boton(p, { ...entorno.cta, freeForDeck: modo.freeForDeck });
    ok(
      `${entorno.nombre} · ${modo.nombre} · con el servidor caído el aviso sigue`,
      p.aviso?.kind === "resume_pending" &&
        pending().length === 1 &&
        cta.action === "resume" &&
        cta.reason === "pending",
      `aviso=${JSON.stringify(p.aviso)} cta=${JSON.stringify(cta)}`
    );
    p.desmontar();

    // 2b. Pagó otra dirección (409). El envío se conserva a propósito.
    limpiar();
    respuesta = {
      status: 409,
      body: { error: "payer_mismatch", payer: entorno.player },
    };
    jugadaPendiente(entorno.player, 15);
    const q = new Pantalla();
    q.montar();
    q.aviso = { kind: "payer_mismatch" }; // lo que pinta `GameShell` con el 409
    await flushOutbox([]);
    const ctaQ = boton(q, { ...entorno.cta, freeForDeck: modo.freeForDeck });
    ok(
      `${entorno.nombre} · ${modo.nombre} · payer_mismatch aguanta hasta reconciliar`,
      q.aviso?.kind === "payer_mismatch" &&
        pending().length === 1 &&
        ctaQ.action === "resume",
      `aviso=${JSON.stringify(q.aviso)} bandeja=${pending().length}`
    );
    q.desmontar();
  }
}

/* ── 3. El candado del dinero no es la etiqueta del botón ────────────────── */

// Y esta distinción es la que hay que dejar por escrito, porque la primera
// versión de este verificador la confundió y salió roja con razón: retirar el
// aviso NO afloja nada. Quien impide el segundo cobro es `decidePlayStart`,
// que vuelve a leer la bandeja ENTERA en cada toque; el aviso solo cuenta lo
// que está pasando. Se prueban los dos por separado y se prueba que el
// segundo no puede desactivar al primero.

console.log("\n— 3. Retirar el aviso no afloja el candado del cobro —\n");

for (const entorno of ENTORNOS) {
  for (const modo of MODOS) {
    limpiar();
    jugadaPendiente(entorno.player, modo.nombre === "gratis" ? 10 : 20);

    const p = new Pantalla();
    p.montar();

    const intentar = () =>
      decidePlayStart({
        expected: entorno.player,
        probe: { status: "answered", accounts: [entorno.player] },
        pending: pendingPlay(),
        canonical: { status: "known", address: entorno.player },
      });

    ok(
      `${entorno.nombre} · ${modo.nombre} · con la jugada sin registrar, tocar Jugar NO cobra`,
      intentar().kind === "resume_pending",
      JSON.stringify(intentar())
    );

    await flushOutbox([]); // ya está registrada: el aviso se retira solo
    ok(
      `${entorno.nombre} · ${modo.nombre} · registrada, el aviso se fue y ahora sí se puede jugar`,
      p.aviso === null && intentar().kind === "proceed",
      `aviso=${JSON.stringify(p.aviso)} decision=${JSON.stringify(intentar())}`
    );

    /**
     * Y el caso que de verdad importa: una jugada NUEVA que se queda sin
     * registrar mientras la app sigue abierta (falla el envío y `handleStart`
     * solo pinta el error, sin poner aviso). El oyente no pone candados —solo
     * los quita— así que el botón sigue diciendo "jugar"… y aun así el cobro
     * está cerrado, porque el guardián relee la bandeja en cada toque.
     */
    jugadaPendiente(entorno.player, 15);
    const cta = boton(p, { ...entorno.cta, freeForDeck: modo.freeForDeck });
    ok(
      `${entorno.nombre} · ${modo.nombre} · si vuelve a quedar pendiente, el guardián lo para igual`,
      intentar().kind === "resume_pending" && cta.action === "start",
      `decision=${JSON.stringify(intentar())} cta=${JSON.stringify(cta)}`
    );
    p.desmontar();
  }
}

/* ── 4. Los demás avisos no son asunto de la bandeja ─────────────────────── */

console.log("\n— 4. Vaciar la bandeja no borra lo que la bandeja no causó —\n");

for (const kind of [
  "reconnect",
  "account_changed",
  "wrong_wallet",
  "checking",
  "needs_name",
  "name_taken",
]) {
  ok(
    `${kind} sobrevive a una bandeja vacía`,
    decidePendingBlockRelease({
      blockKind: kind,
      pending: null,
      paying: false,
    }) === false
  );
}
ok(
  "sin aviso puesto no hay nada que retirar",
  decidePendingBlockRelease({
    blockKind: null,
    pending: null,
    paying: false,
  }) === false
);
ok(
  "con un cobro en curso manda quien lo conduce",
  decidePendingBlockRelease({
    blockKind: "resume_pending",
    pending: null,
    paying: true,
  }) === false
);

/* ── 5. Otra pestaña, y la baja del oyente ───────────────────────────────── */

console.log("\n— 5. Otra pestaña registra la jugada; y el oyente se retira —\n");

{
  limpiar();
  jugadaPendiente("0x46d5000000000000000000000000000000008c18", 10);
  const p = new Pantalla();
  p.montar();
  const antes = p.aviso?.kind;
  otraPestanaVaciaLaBandeja();
  ok(
    "lo que registra otra pestaña también apaga el aviso aquí",
    antes === "resume_pending" && p.aviso === null,
    `antes=${antes} después=${JSON.stringify(p.aviso)}`
  );

  ok(
    "mientras hay pantalla, hay un oyente de storage",
    oyentesStorage.size === 1
  );
  p.desmontar();
  ok("al desmontar no queda ninguno", oyentesStorage.size === 0);

  // Dos pantallas a la vez: UN solo oyente para las dos, y se va con la última.
  const a = new Pantalla();
  const b = new Pantalla();
  a.montar();
  b.montar();
  const conDos = oyentesStorage.size;
  a.desmontar();
  const conUna = oyentesStorage.size;
  b.desmontar();
  ok(
    "un único oyente compartido, retirado con el último suscriptor",
    conDos === 1 && conUna === 1 && oyentesStorage.size === 0,
    `conDos=${conDos} conUna=${conUna} final=${oyentesStorage.size}`
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
