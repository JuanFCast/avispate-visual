// Verifica que nunca exista "pagó la entrada pero no pudo registrar su silla".
//
// ── El agujero que esto cierra ──────────────────────────────────────────────
//
// Dentro de MiniPay no se puede firmar un mensaje, así que la sesión del jugador
// nuevo nace de la propia transacción de entrada. `ensureWalletSession` se
// disparaba en cuanto existía el hash, ANTES de esperar el recibo y sin `await`:
// el servidor pedía el recibo de una transacción todavía no minada, no lo
// encontraba y la sesión no se abría. Nadie lo reintentaba. El paso siguiente
// —`/rooms/[code]/paid`, que sí pide sesión— se comía cinco 401 idénticos contra
// la misma cabecera vacía y se rendía. Resultado: entrada pagada en la cadena y
// silla imposible de registrar, que es el peor final que este camino tiene.
//
// El arreglo son dos cosas y aquí se comprueban las dos:
//   1. la sesión se pide DESPUÉS del recibo (cheque sobre el código fuente);
//   2. un 401 ya no es "espera", es "te falta la sesión": se recupera y se
//      reintenta en el acto (`registerSeat`, recorrido entero aquí).
//
// Correr: node scripts/verify-arena-register.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  PAID_BACKOFF_MS,
  SEAT_BACKOFF_MS,
  registerSeat,
  type RegisterSeatResult,
} from "../lib/arena-register.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok
        ? ""
        : `\n         esperado ${JSON.stringify(expected)}` +
          `\n         recibido ${JSON.stringify(actual)}`)
  );
}

const TOKEN = "seat-token-abc";

interface Registro {
  result: RegisterSeatResult;
  /** Códigos que devolvió cada intento de registrar, en orden. */
  paid: number[];
  /** Cuántas veces se fue a buscar sesión. */
  sessions: number;
  /** Cada espera, en ms. Su suma es lo que el jugador aguanta mirando. */
  waits: number[];
  /** Cuántas veces se intentó canjear la ficha. */
  seats: number;
  stages: string[];
}

/**
 * Corre el registro contra un servidor de mentira.
 *
 * `paidStatuses` es lo que contesta `/paid` intento tras intento; el último se
 * repite para siempre, que es como se comporta un fallo que no se cura.
 * `sessionAt` dice a partir de qué intento de recuperación hay sesión de verdad.
 */
async function correr(opts: {
  paidStatuses: number[];
  /** Qué contesta `/paid` en cuanto hay sesión. Por defecto, 200. */
  paidWithSession?: number;
  /** Intento de recuperación (1 = el primero) en el que la sesión ya sale. */
  sessionAt?: number | null;
  /** Ficha: en qué intento aparece. `null` = nunca. */
  seatAt?: number | null;
}): Promise<Registro> {
  const paid: number[] = [];
  const waits: number[] = [];
  let sessions = 0;
  let seats = 0;
  let haySesion = false;
  const stages: string[] = [];

  const result = await registerSeat({
    onStage: (s) => stages.push(s),
    wait: async (ms) => {
      waits.push(ms);
    },
    postPaid: async () => {
      const i = paid.length;
      const status = haySesion
        ? (opts.paidWithSession ?? 200)
        : (opts.paidStatuses[i] ?? opts.paidStatuses[opts.paidStatuses.length - 1]);
      paid.push(status);
      return status;
    },
    recoverSession: async () => {
      sessions++;
      if (opts.sessionAt !== null && opts.sessionAt !== undefined) {
        if (sessions >= opts.sessionAt) haySesion = true;
      }
      return haySesion;
    },
    postSeat: async () => {
      seats++;
      const at = opts.seatAt === undefined ? 1 : opts.seatAt;
      return at !== null && seats >= at ? TOKEN : null;
    },
  });

  return { result, paid, sessions, waits, seats, stages };
}

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

console.log("\n— El camino bueno: ya había sesión —");
{
  const r = await correr({ paidStatuses: [200] });
  check("registra y devuelve la ficha", r.result, { ok: true, token: TOKEN });
  check("un solo intento de registrar", r.paid.length, 1);
  check("no se pidió sesión: no hizo falta", r.sessions, 0);
  check("no se esperó nada", r.waits, []);
  check("y avisó de los dos pasos", r.stages, ["registering", "claiming"]);
}

console.log("\n— EL CASO: jugador nuevo de MiniPay, primer intento sin sesión —");
{
  const r = await correr({ paidStatuses: [401], sessionAt: 1 });
  check("acaba registrado y con ficha", r.result, { ok: true, token: TOKEN });
  check("fue a buscar la sesión", r.sessions, 1);
  check("y reintentó: dos llamadas a /paid", r.paid, [401, 200]);
  // Lo que de verdad se arregló: el 401 no se trata como un fallo de red. Lo
  // que faltaba era la sesión, no el tiempo, así que esperar sería perderlo.
  check("SIN esperar entre las dos", r.waits, []);
}

console.log("\n— La sesión tarda: el nodo del servidor va detrás —");
{
  const r = await correr({ paidStatuses: [401], sessionAt: 3 });
  check("igual termina registrado", r.result, { ok: true, token: TOKEN });
  check("se pidió sesión en cada 401, no solo en el primero", r.sessions, 3);
  check("y el reintento gratis se gastó una sola vez", r.waits, [1500, 3000]);
}

console.log("\n— La sesión NO llega nunca —");
{
  const r = await correr({ paidStatuses: [401], sessionAt: null });
  check(
    "no se registra, y se dice por qué",
    r.result,
    { ok: false, reason: "not_registered" }
  );
  // Que se rinda está bien; lo que no puede es rendirse en silencio ni pedir
  // pagar otra vez. `not_registered` es lo que deja el pago marcado como
  // pendiente y el botón en "Terminar de registrar".
  check("intentó las veces previstas y ni una más", r.paid.length, PAID_BACKOFF_MS.length + 1);
  check("esperó exactamente el escalonado previsto", r.waits, [...PAID_BACKOFF_MS]);
  check("y no se quedó colgado: menos de 40 s", suma(r.waits) < 40_000, true);
  check("nunca llegó a pedir la ficha", r.seats, 0);
}

console.log("\n— Y no hay bucle infinito si la sesión existe pero no sirve —");
{
  // El caso feo: `recoverSession` contesta que sí (hay sesión guardada) pero
  // `/paid` la rechaza igual. Sin el freno del reintento único, esto gira para
  // siempre sin tocar la red y con el teléfono al rojo.
  const r = await correr({
    paidStatuses: [401],
    paidWithSession: 401,
    sessionAt: 1,
  });
  check("se rinde", r.result, { ok: false, reason: "not_registered" });
  check("con un número acotado de intentos", r.paid.length, PAID_BACKOFF_MS.length + 2);
  check("y habiendo esperado de verdad entre ellos", r.waits, [...PAID_BACKOFF_MS]);
}

console.log("\n— El nodo todavía no ve la transacción (400, no 401) —");
{
  const r = await correr({ paidStatuses: [400, 400, 200] });
  check("espera y termina registrando", r.result, { ok: true, token: TOKEN });
  check("sin ir a buscar sesión: no era eso", r.sessions, 0);
  check("con dos esperas", r.waits, [1500, 3000]);
}

console.log("\n— Sin red: un fallo sin código HTTP se trata como pasajero —");
{
  const r = await correr({ paidStatuses: [0, 0, 200] });
  check("reintenta y registra", r.result, { ok: true, token: TOKEN });
  check("no lo confunde con falta de sesión", r.sessions, 0);
}

console.log("\n— Un 409 no se arregla esperando —");
{
  const r = await correr({ paidStatuses: [409] });
  check("para en seco", r.result, { ok: false, reason: "conflict" });
  check("un solo intento", r.paid.length, 1);
  check("y cero esperas: insistir solo retrasa el aviso", r.waits, []);
}

console.log("\n— La ficha llega tarde, pero llega —");
{
  const r = await correr({ paidStatuses: [200], seatAt: 3 });
  check("acaba con ficha", r.result, { ok: true, token: TOKEN });
  check("tres intentos de canje", r.seats, 3);
  check("con las esperas del canje", r.waits, [1500, 3000]);
}

console.log("\n— Registrado pero sin ficha: se distingue, no se confunde —");
{
  const r = await correr({ paidStatuses: [200], seatAt: null });
  check(
    "la silla existe; lo que falta es el permiso",
    r.result,
    { ok: false, reason: "no_seat_token" }
  );
  check("intentó el canje lo previsto", r.seats, SEAT_BACKOFF_MS.length + 1);
  check("y no pide sesión: canjear nunca la necesitó", r.sessions, 0);
}

console.log("\n— La regla de oro: ningún final malo manda a pagar otra vez —");
{
  const finales: RegisterSeatResult[] = [
    (await correr({ paidStatuses: [409] })).result,
    (await correr({ paidStatuses: [401], sessionAt: null })).result,
    (await correr({ paidStatuses: [200], seatAt: null })).result,
  ];
  check(
    "los tres se identifican, y ninguno es un éxito silencioso",
    finales.map((f) => (f.ok ? "ok" : f.reason)),
    ["conflict", "not_registered", "no_seat_token"]
  );

  const src = readFileSync(join(ROOT, "lib/arena-join.ts"), "utf8");
  // El pago pendiente es lo que hace que el botón diga "Terminar de registrar"
  // en vez de "Pagar". Olvidarlo sin ficha en la mano sería cobrar dos veces.
  const olvidos = [...src.matchAll(/forgetSeatPayment\(/g)].length;
  const trasFicha = [...src.matchAll(/rememberSeatToken\([\s\S]{0,120}?forgetSeatPayment\(/g)]
    .length;
  check(
    "solo se olvida el pago pendiente después de guardar la ficha",
    olvidos === trasFicha && olvidos > 0,
    true
  );
}

console.log("\n— El orden en el código: la sesión, después de intentar el recibo —");
{
  const src = readFileSync(join(ROOT, "lib/arena-join.ts"), "utf8");
  // El recibo de `join` ahora se espera DENTRO de `submitJoin`
  // (`lib/arena-pay-sequence.ts`, probado aparte en
  // `verify-arena-fee-currency.ts`): un timeout ahí ya no lanza, así que lo
  // que este cheque puede seguir viendo desde aquí es que `ensureWalletSession`
  // se pide DESPUÉS de que `submitJoin` haya terminado su intento — no antes,
  // suelto, en cuanto existe el hash.
  const submit = src.indexOf("await submitJoin(");
  const sesion = src.indexOf("await ensureWalletSession(account, txHash)");

  check("los dos siguen ahí", submit > -1 && sesion > -1, true);
  check(
    "y la sesión se pide DESPUÉS del intento de recibo de `join`",
    submit < sesion,
    true
  );
  check(
    "y ya no se dispara suelta con `void`",
    /void ensureWalletSession/.test(src),
    false
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
