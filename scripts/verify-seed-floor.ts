// El pozo que se quedó en cero, y por qué ahora no puede volver a pasar.
//
// La madrugada del 2026-08-16 la siembra de los tres mazos no salió y nadie la
// reintentó: `roll-day` sembraba solo lo que acababa de pagar, el respaldo de
// las 00:05 devolvía `already_settled`, y desde el día siguiente un pozo en
// cero ya ni entraba a liquidarse (`payable` exige `pot > 0`). Cero era un
// estado absorbente y el juego siguió cobrando entradas por un premio de 0,00.
//
// Aquí se prueban las dos mitades del arreglo:
//   1. la regla pura: `faltante = max(0, SUELO − pozo)`, idempotente; y
//   2. el robot entero contra una cadena y una base de datos de mentira,
//      incluidas las dos cosas que dan miedo — dos corridas solapadas y una
//      transacción que falla.
//
// Correr: node scripts/verify-seed-floor.ts
import {
  planSeed,
  isClosePending,
  msSinceUtcMidnight,
  fmtUnits,
  FLOOR_UNITS,
  ROUND_CAP_UNITS,
  RUN_CAP_UNITS,
  SKIP,
  ABORT,
} from "../lib/seed-rules.ts";
import {
  seedToFloor,
  currentRound,
  closedRound,
  type SeedDeps,
  type LeaseRow,
  type ReleasePatch,
} from "../lib/seed-floor.ts";

let failed = 0;

/** Los montos son bigint y `JSON.stringify` no sabe serializarlos. */
const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));

function check(name: string, actual: unknown, expected: unknown) {
  const ok = show(actual) === show(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok
        ? ""
        : `\n         esperado ${show(expected)}` +
          `\n         recibido ${show(actual)}`)
  );
}

/** 0,30 USDT → 300000n. Para escribir los casos en dinero, no en unidades. */
const usdt = (s: string): bigint => {
  const [w, f = ""] = s.split(".");
  return BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
};

/** Entrada por defecto: todo en orden, solo cambia lo que diga cada caso. */
function input(over: Partial<Parameters<typeof planSeed>[0]> = {}) {
  return {
    pot: 0n,
    floor: FLOOR_UNITS,
    spentThisRound: 0n,
    roundCap: ROUND_CAP_UNITS,
    runCap: RUN_CAP_UNITS,
    closePending: false,
    funderBalance: usdt("19.00"),
    allowance: usdt("1000000"),
    ...over,
  };
}

console.log("\n— El suelo son 0,30 y se completa, no se suma —");
{
  // Los cuatro casos que pidió el encargo, en dinero:
  //   0,00 (el pozo muerto de anoche) · 0,08 (una entrada pagada) ·
  //   0,29 (a un céntimo) · 0,30 (justo en el suelo).
  check("pozo 0.00 → aporta 0.30", planSeed(input({ pot: usdt("0") })), {
    act: true,
    amount: usdt("0.30"),
  });
  check("pozo 0.08 → aporta 0.22", planSeed(input({ pot: usdt("0.08") })), {
    act: true,
    amount: usdt("0.22"),
  });
  check("pozo 0.29 → aporta 0.01", planSeed(input({ pot: usdt("0.29") })), {
    act: true,
    amount: usdt("0.01"),
  });
  check("pozo 0.30 → no pone nada", planSeed(input({ pot: usdt("0.30") })), {
    act: false,
    kind: "skip",
    reason: SKIP.AT_FLOOR,
    amount: 0n,
  });
  check(
    "pozo 0.46 (la gente pagó) → tampoco",
    planSeed(input({ pot: usdt("0.46") })),
    { act: false, kind: "skip", reason: SKIP.AT_FLOOR, amount: 0n }
  );

  // Lo que hace que correrlo cada hora sea gratis: el destino es un tope.
  const primera = planSeed(input({ pot: usdt("0") }));
  const pozoTras = primera.act ? usdt("0") + primera.amount : usdt("0");
  check(
    "y la segunda corrida seguida ya no pone nada",
    planSeed(input({ pot: pozoTras })),
    { act: false, kind: "skip", reason: SKIP.AT_FLOOR, amount: 0n }
  );
}

console.log("\n— Las guardas, y qué impide cada una —");
{
  check(
    "cierre pendiente: no se siembra lo que settle está a punto de llevarse",
    planSeed(input({ pot: 0n, closePending: true })),
    { act: false, kind: "skip", reason: SKIP.CLOSE_PENDING, amount: 0n }
  );
  check(
    "tope de ronda: ya se puso el máximo del día en este mazo",
    planSeed(input({ pot: 0n, spentThisRound: ROUND_CAP_UNITS })),
    { act: false, kind: "skip", reason: SKIP.ROUND_CAP, amount: usdt("0.30") }
  );
  check(
    "un suelo mal escrito no vacía el Funder",
    planSeed(input({ pot: 0n, floor: usdt("50"), runCap: RUN_CAP_UNITS })),
    { act: false, kind: "abort", reason: ABORT.OVER_CAP, amount: usdt("50") }
  );
  check(
    "sin USDT no se firma",
    planSeed(input({ pot: 0n, funderBalance: usdt("0.10") })),
    { act: false, kind: "abort", reason: ABORT.NO_BALANCE, amount: usdt("0.30") }
  );
  check(
    "sin allowance tampoco",
    planSeed(input({ pot: 0n, allowance: usdt("0.05") })),
    {
      act: false,
      kind: "abort",
      reason: ABORT.NO_ALLOWANCE,
      amount: usdt("0.30"),
    }
  );
  // El orden importa: con el pozo lleno da igual que falte plata, no se toca.
  check(
    "el pozo lleno gana a la falta de saldo",
    planSeed(input({ pot: usdt("0.30"), funderBalance: 0n })),
    { act: false, kind: "skip", reason: SKIP.AT_FLOOR, amount: 0n }
  );
}

console.log("\n— La guarda de cierre está ACOTADA, y esto es el porqué —");
{
  const VENTANA = 90 * 60_000;
  check("liquidado → no hay nada que esperar", isClosePending(true, 0, VENTANA), false);
  check(
    "sin liquidar a los 35 min → esperar",
    isClosePending(false, 35 * 60_000, VENTANA),
    true
  );
  // Esta es LA diferencia con TypeRush. Allí el pozo va por día y la guarda
  // puede esperar para siempre; aquí `pot[mazo]` es un saldo corriente, así que
  // esperar indefinidamente a una liquidación que no llega reproduciría el pozo
  // muerto que venimos a arreglar.
  check(
    "sin liquidar a las 2 h → se siembra IGUAL",
    isClosePending(false, 2 * 3_600_000, VENTANA),
    false
  );

  const medianoche = Date.parse("2026-08-17T00:00:00.000Z");
  check("medianoche UTC es el cero", msSinceUtcMidnight(medianoche), 0);
  check(
    "y las 00:35 son 35 minutos",
    msSinceUtcMidnight(medianoche + 35 * 60_000),
    35 * 60_000
  );
}

console.log("\n— Fechas de ronda: se siembra HOY, se comprueba el cierre de AYER —");
{
  const t = Date.parse("2026-08-17T00:35:00.000Z");
  check("ronda abierta", currentRound(t), "2026-08-17");
  check("ronda que cerró", closedRound(t), "2026-08-16");
}

/* ---------------------------------------------------------------------- */
/*  El robot entero, contra una cadena y una base de datos de mentira      */
/* ---------------------------------------------------------------------- */

/**
 * Un mundo de juguete: tres pozos, un cerrojo por mazo y un Funder.
 *
 * `fallar` marca los mazos cuya transacción se cae (así se simula el choque de
 * nonce del 16). `reloj` se mueve a mano para probar el cambio de ronda.
 */
function mundo(opts: {
  pozos: Record<number, bigint>;
  liquidado?: boolean;
  fallar?: Set<number>;
  saldo?: bigint;
  allowance?: bigint;
  ahora?: number;
}) {
  const pozos = { ...opts.pozos };
  const cerrojos = new Map<number, { until: number; row: LeaseRow }>();
  let ahora = opts.ahora ?? Date.parse("2026-08-17T00:35:00.000Z");
  const log = { envíos: [] as { deck: number; amount: bigint }[], claims: 0 };

  const deps: SeedDeps = {
    now: () => ahora,
    async readPot(deck) {
      return pozos[deck] ?? 0n;
    },
    async readFunder() {
      return {
        address: "0xFunder",
        balance: opts.saldo ?? usdt("19.00"),
        allowance: opts.allowance ?? usdt("1000000"),
      };
    },
    async isSettled() {
      return opts.liquidado ?? true;
    },
    async claim(deck, leaseMs) {
      log.claims++;
      const held = cerrojos.get(deck);
      if (held && held.until > ahora) return null;
      const row: LeaseRow = held?.row ?? {
        roundDate: currentRound(ahora),
        spentUnits: 0n,
      };
      cerrojos.set(deck, { until: ahora + leaseMs, row });
      return row;
    },
    async release(deck, patch: ReleasePatch) {
      cerrojos.set(deck, {
        until: 0,
        row: { roundDate: patch.roundDate, spentUnits: patch.spentUnits },
      });
    },
    async sendSeed(deck, amount) {
      if (opts.fallar?.has(deck)) {
        return { ok: false, error: "nonce too low" };
      }
      log.envíos.push({ deck, amount });
      pozos[deck] = (pozos[deck] ?? 0n) + amount;
      return { ok: true, txHash: `0xtx${deck}` };
    },
  };

  return {
    deps,
    pozos,
    log,
    cerrojos,
    avanzar: (ms: number) => {
      ahora += ms;
    },
    /** Deja el cerrojo tomado por otra corrida, como si fueran simultáneas. */
    ocupar: (deck: number, ms: number) =>
      cerrojos.set(deck, {
        until: ahora + ms,
        row: { roundDate: currentRound(ahora), spentUnits: 0n },
      }),
  };
}

console.log("\n— Los tres pozos muertos vuelven al suelo —");
{
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n } });
  const r = await seedToFloor(m.deps);

  check("los tres se siembran", r.decks.map((d) => d.action), [
    "sembrado",
    "sembrado",
    "sembrado",
  ]);
  check("cada uno con 0.30", r.decks.map((d) => d.amount), ["0.30", "0.30", "0.30"]);
  check("y quedan en el suelo", r.decks.map((d) => d.potAfter), [
    "0.30",
    "0.30",
    "0.30",
  ]);
  check("sin alarma", r.alarm, false);
  check("tres transacciones, ni una más", m.log.envíos.length, 3);
}

console.log("\n— Correrlo otra vez seguido no pone un céntimo más —");
{
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n } });
  await seedToFloor(m.deps);
  const enviosTrasLaPrimera = m.log.envíos.length;
  const r2 = await seedToFloor(m.deps);

  check("la segunda salta los tres", r2.decks.map((d) => d.reason), [
    SKIP.AT_FLOOR,
    SKIP.AT_FLOOR,
    SKIP.AT_FLOOR,
  ]);
  check("y no firma nada", m.log.envíos.length, enviosTrasLaPrimera);
  check("sin alarma", r2.alarm, false);
}

console.log("\n— Mezcla real: uno muerto, uno a medias, uno lleno —");
{
  const m = mundo({
    pozos: { 10: 0n, 15: usdt("0.08"), 20: usdt("0.46") },
  });
  const r = await seedToFloor(m.deps);

  check("aportes", r.decks.map((d) => d.amount), ["0.30", "0.22", "0.00"]);
  check("acciones", r.decks.map((d) => d.action), [
    "sembrado",
    "sembrado",
    "saltado",
  ]);
  check(
    "el que ya estaba lleno se queda como estaba",
    r.decks[2].potAfter,
    "0.46"
  );
  check("dos transacciones", m.log.envíos.length, 2);
}

console.log("\n— Dos crons solapados NO siembran dos veces —");
{
  // El caso que el encargo pide "evitar absolutamente": el cron de Vercel y el
  // de Supabase entrando a la vez. Sin cerrojo los dos leen 0,00 y los dos
  // firman 0,30 → el pozo acaba en 0,60 y la casa paga doble.
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n } });
  m.ocupar(10, 60_000);
  m.ocupar(15, 60_000);
  m.ocupar(20, 60_000);

  const r = await seedToFloor(m.deps);
  check("la segunda corrida se va de vacío", r.decks.map((d) => d.reason), [
    SKIP.LOCKED,
    SKIP.LOCKED,
    SKIP.LOCKED,
  ]);
  check("sin firmar nada", m.log.envíos.length, 0);
  check("y sin alarma: no es un fallo, es el cerrojo", r.alarm, false);
}

console.log("\n— El cerrojo vence: una corrida colgada no bloquea el pozo —");
{
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n } });
  m.ocupar(10, 120_000);
  m.avanzar(121_000);

  const r = await seedToFloor(m.deps);
  check("el mazo 10 se recupera igual", r.decks[0].action, "sembrado");
  check("y llega al suelo", r.decks[0].potAfter, "0.30");
}

console.log("\n— Una transacción que falla se reintenta a la hora siguiente —");
{
  // Exactamente lo del 16: el envío se cae por un choque de nonce. Antes eso
  // era definitivo; ahora la corrida siguiente lo recoge.
  const fallar = new Set([15]);
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n }, fallar });

  const r1 = await seedToFloor(m.deps);
  check("el mazo 15 falla", r1.decks[1].action, "falló");
  check("y lo dice", r1.decks[1].error, "nonce too low");
  check("con alarma encendida", r1.alarm, true);
  check("los otros dos sí entraron", [r1.decks[0].action, r1.decks[2].action], [
    "sembrado",
    "sembrado",
  ]);

  // A la hora siguiente la cadena ya deja pasar la transacción.
  fallar.delete(15);
  m.avanzar(3_600_000);
  const r2 = await seedToFloor(m.deps);

  check("el 15 se recupera", r2.decks[1].action, "sembrado");
  check("con los 0.30 enteros (el fallo no contó gasto)", r2.decks[1].amount, "0.30");
  check("y ya no hay alarma", r2.alarm, false);
  check("los otros dos no se vuelven a sembrar", [
    r2.decks[0].reason,
    r2.decks[2].reason,
  ], [SKIP.AT_FLOOR, SKIP.AT_FLOOR]);
}

console.log("\n— El tope de ronda para un robot en bucle —");
{
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n } });
  // Tres vaciados seguidos DENTRO de la misma ronda: solo pueden entrar dos
  // suelos. El tercero se para y enciende la alarma.
  await seedToFloor(m.deps, [10]);
  m.pozos[10] = 0n;
  m.deps.readPot = async () => 0n;
  const r2 = await seedToFloor(m.deps, [10]);
  check("el segundo suelo todavía entra", r2.decks[0].action, "sembrado");

  const r3 = await seedToFloor(m.deps, [10]);
  check("el tercero se para", r3.decks[0].reason, SKIP.ROUND_CAP);
  check("y avisa, porque el pozo queda corto", r3.alarm, true);
}

console.log("\n— Cambia la ronda y el gasto vuelve a cero —");
{
  const m = mundo({ pozos: { 10: 0n } });
  await seedToFloor(m.deps, [10]);
  await seedToFloor(m.deps, [10]);

  // Día siguiente: settle vació el pozo y el contador de gasto se reinicia.
  m.avanzar(86_400_000);
  m.deps.readPot = async () => 0n;
  const r = await seedToFloor(m.deps, [10]);
  check("la ronda nueva puede sembrar", r.decks[0].action, "sembrado");
  check("y es la ronda de mañana", r.round, "2026-08-18");
}

console.log("\n— Cierre sin liquidar: se espera dentro de la ventana —");
{
  const m = mundo({
    pozos: { 10: 0n, 15: 0n, 20: 0n },
    liquidado: false,
    ahora: Date.parse("2026-08-17T00:35:00.000Z"),
  });
  const r = await seedToFloor(m.deps);
  check("no se siembra encima de un pago en camino", r.decks.map((d) => d.reason), [
    SKIP.CLOSE_PENDING,
    SKIP.CLOSE_PENDING,
    SKIP.CLOSE_PENDING,
  ]);
  check("sin firmar nada", m.log.envíos.length, 0);
  check("y sin alarma: es lo esperado a esa hora", r.alarm, false);
}

console.log("\n— …pero pasada la ventana se siembra igual —");
{
  // Si `roll-day` se cayera del todo, esperar para siempre sería repetir el bug.
  const m = mundo({
    pozos: { 10: 0n, 15: 0n, 20: 0n },
    liquidado: false,
    ahora: Date.parse("2026-08-17T02:35:00.000Z"),
  });
  const r = await seedToFloor(m.deps);
  check("los tres se siembran", r.decks.map((d) => d.action), [
    "sembrado",
    "sembrado",
    "sembrado",
  ]);
}

console.log("\n— Funder sin fondos: se aborta y suena la alarma —");
{
  const m = mundo({ pozos: { 10: 0n, 15: 0n, 20: 0n }, saldo: usdt("0.10") });
  const r = await seedToFloor(m.deps);
  check("aborta por saldo", r.decks[0].reason, ABORT.NO_BALANCE);
  check("sin firmar nada", m.log.envíos.length, 0);
  check("con alarma", r.alarm, true);
  check("y el informe dice cuánto tenía", r.funderBalance, "0.10");
}

console.log("\n— Funder sin allowance: igual, y se distingue del anterior —");
{
  const m = mundo({
    pozos: { 10: 0n, 15: 0n, 20: 0n },
    allowance: usdt("0.05"),
  });
  const r = await seedToFloor(m.deps);
  check("aborta por allowance", r.decks[0].reason, ABORT.NO_ALLOWANCE);
  check("con alarma", r.alarm, true);
}

console.log("\n— El cerrojo se suelta aunque explote la lectura del pozo —");
{
  const m = mundo({ pozos: { 10: 0n } });
  m.deps.readPot = async () => {
    throw new Error("RPC caído");
  };
  const r = await seedToFloor(m.deps, [10]);
  check("se informa el fallo", r.decks[0].action, "falló");
  check("con alarma", r.alarm, true);
  check("y el cerrojo quedó libre", m.cerrojos.get(10)?.until, 0);

  // Y con el RPC de vuelta, la corrida siguiente entra sin esperar arriendo.
  m.deps.readPot = async () => 0n;
  const r2 = await seedToFloor(m.deps, [10]);
  check("la corrida siguiente siembra", r2.decks[0].action, "sembrado");
}

console.log("\n— El formateador, que es lo que se lee en el informe —");
{
  check("cero", fmtUnits(0n), "0.00");
  check("suelo", fmtUnits(FLOOR_UNITS), "0.30");
  check("un céntimo", fmtUnits(usdt("0.01")), "0.01");
  check("con decimales que se cortan", fmtUnits(usdt("1.239")), "1.23");
  check("grande", fmtUnits(usdt("19.35")), "19.35");
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
// `exitCode` y no `process.exit()`: en Windows, salir a la fuerza con la última
// escritura de stdout todavía en vuelo hace abortar a libuv y el guion termina
// con un código distinto de 0 aunque todas las comprobaciones hayan pasado.
// `verify-arena-actor.ts` lo hace 2 de cada 12 veces cuando la salida va a
// /dev/null, que es justo como los corre el bucle de la suite.
process.exitCode = failed === 0 ? 0 : 1;
