// Verifica que la Arena juegue con las MISMAS reglas de MiniPay que el reto
// diario: el gas se paga en USDT con 0 CELO, la propia entrada abre sesión sin
// pasar por el reto individual, y un recibo lento nunca cobra dos veces.
//
// ── Lo que este archivo NO prueba ───────────────────────────────────────────
//
// `useArenaJoin` es un hook de React/wagmi: firmar de verdad, esperar un
// recibo real y leer la cadena no se pueden recorrer aquí. Por eso la lógica
// que de verdad decide algo vive en funciones puras —`resolveFeeCurrency`
// (`lib/celo-tx.ts`), `seatEntryGateFor` (`lib/arena-rooms.ts`) y
// `ensureAllowance`/`submitJoin` (`lib/arena-pay-sequence.ts`)— con los
// efectos (firmar, esperar, leer) inyectados por parámetro. `arena-join.ts`
// es solo el cableado que las conecta a wagmi; unos pocos cheques de código
// fuente al final comprueban que ese cableado sigue en pie.
//
// Correr: node scripts/verify-arena-fee-currency.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveFeeCurrency, type BalanceReader } from "../lib/celo-tx.ts";
import { seatEntryGateFor } from "../lib/arena-rooms.ts";
import { ensureAllowance, submitJoin } from "../lib/arena-pay-sequence.ts";
import { CIP64_FEE_ADAPTER } from "../lib/contracts.ts";

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

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const ADDR = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18" as `0x${string}`;
const FEE = { feeCurrency: CIP64_FEE_ADAPTER as `0x${string}` };

console.log("\n— MiniPay con 0 CELO: el gas SIEMPRE se paga en USDT —");
{
  let balanceReads = 0;
  const client: BalanceReader = {
    getBalance: async () => {
      balanceReads++;
      return 0n;
    },
    getGasPrice: async () => {
      balanceReads++;
      return 5_000_000_000n;
    },
  };
  const result = await resolveFeeCurrency(client, ADDR, 220_000n, true);
  check("usa el adaptador CIP-64", result, FEE);
  check(
    "ni siquiera mira el saldo de CELO — dentro de MiniPay es irrelevante",
    balanceReads,
    0
  );
}

console.log("\n— Fuera de MiniPay: CELO si alcanza, USDT si no (sin cambios) —");
{
  const rico: BalanceReader = {
    getBalance: async () => 10n ** 18n,
    getGasPrice: async () => 5_000_000_000n,
  };
  const pobre: BalanceReader = {
    getBalance: async () => 0n,
    getGasPrice: async () => 5_000_000_000n,
  };
  check(
    "con CELO de sobra, paga en CELO",
    await resolveFeeCurrency(rico, ADDR, 220_000n, false),
    {}
  );
  check(
    "sin CELO, cae a USDT",
    await resolveFeeCurrency(pobre, ADDR, 220_000n, false),
    FEE
  );
}

console.log("\n— Primer ingreso a una mesa paga desde MiniPay, sin sesión —");
{
  check(
    "MiniPay + mesa paga + sin sesión → paga directo, NO AccessCard",
    seatEntryGateFor({
      seated: false,
      full: false,
      ready: true,
      authenticated: false,
      inMiniPay: true,
      hasTableId: true,
    }),
    "pay_seat"
  );
  check(
    "fuera de MiniPay, mesa paga + sin sesión → sigue pidiendo login (SIN CAMBIOS)",
    seatEntryGateFor({
      seated: false,
      full: false,
      ready: true,
      authenticated: false,
      inMiniPay: false,
      hasTableId: true,
    }),
    "needs_login"
  );
  check(
    "MiniPay + mesa GRATIS + sin sesión → sigue pidiendo login (no hay pago que abra sesión)",
    seatEntryGateFor({
      seated: false,
      full: false,
      ready: true,
      authenticated: false,
      inMiniPay: true,
      hasTableId: false,
    }),
    "needs_login"
  );
  check(
    "ya autenticado, MiniPay + mesa paga → paga igual",
    seatEntryGateFor({
      seated: false,
      full: false,
      ready: true,
      authenticated: true,
      inMiniPay: true,
      hasTableId: true,
    }),
    "pay_seat"
  );
  check(
    "mesa llena manda sobre todo lo demás",
    seatEntryGateFor({
      seated: false,
      full: true,
      ready: true,
      authenticated: false,
      inMiniPay: true,
      hasTableId: true,
    }),
    "full"
  );
  check(
    "ya sentado no hay nada que decidir",
    seatEntryGateFor({
      seated: true,
      full: false,
      ready: true,
      authenticated: false,
      inMiniPay: true,
      hasTableId: true,
    }),
    "seated"
  );
}

console.log(
  "\n— El camino feliz completo: MiniPay, wallet nueva, 0 CELO, USDT suficiente —"
);
{
  const feeCurrency = await resolveFeeCurrency(
    { getBalance: async () => 0n, getGasPrice: async () => 5_000_000_000n },
    ADDR,
    220_000n,
    true
  );
  let approveCalls = 0;
  let joinCalls = 0;
  let approveFee: unknown = null;
  let joinFee: unknown = null;

  const gate = await ensureAllowance({
    entryUnits: 1_000_000n,
    feeCurrency,
    readAllowance: async () => 0n, // sin permiso todavía
    approve: async (fee) => {
      approveCalls++;
      approveFee = fee;
      return "0xApprove";
    },
    waitApproveReceipt: async () => {},
  });
  check("el permiso queda listo", gate, { kind: "ready" });
  check("el approve del camino feliz llevó el gas en USDT", approveFee, FEE);

  const hash = await submitJoin({
    feeCurrency,
    join: async (fee) => {
      joinCalls++;
      joinFee = fee;
      return "0xJoin";
    },
    waitJoinReceipt: async () => {},
    onJoinHash: () => {},
  });
  check("queda sentado con el hash del join", hash, "0xJoin");
  check("el join también llevó el gas en USDT", joinFee, FEE);
  check("exactamente un approve y un join — nunca de más", [approveCalls, joinCalls], [1, 1]);
}

console.log("\n— Cancelar el approve en la hoja de firma: nada se cobra —");
{
  const msg = await rejects(() =>
    ensureAllowance({
      entryUnits: 1_000_000n,
      feeCurrency: FEE,
      readAllowance: async () => 0n,
      approve: async () => {
        throw new Error("User rejected the request");
      },
      waitApproveReceipt: async () => {},
    })
  );
  check("el rechazo sube tal cual, sin disfrazarse de otra cosa", /rejected/i.test(msg ?? ""), true);
}

console.log("\n— Cancelar el join en la hoja de firma: no se guarda ningún rastro —");
{
  let hashesGuardados = 0;
  const msg = await rejects(() =>
    submitJoin({
      feeCurrency: FEE,
      join: async () => {
        throw new Error("User rejected the request");
      },
      waitJoinReceipt: async () => {},
      onJoinHash: () => {
        hashesGuardados++;
      },
    })
  );
  check("el rechazo sube", msg !== null, true);
  check(
    "onJoinHash NUNCA se llamó: sin hash no hay nada que guardar ni con qué reintentar cobrar",
    hashesGuardados,
    0
  );
}

console.log("\n— El recibo del join tarda más de 20 s: NO vuelve a cobrar —");
{
  let joinCalls = 0;
  let hashesGuardados = 0;
  const hash = await submitJoin({
    feeCurrency: FEE,
    join: async () => {
      joinCalls++;
      return "0xJoinLento";
    },
    waitJoinReceipt: async () => {
      throw new Error("Timed out while waiting for transaction receipt");
    },
    onJoinHash: () => {
      hashesGuardados++;
    },
  });
  check("sigue adelante con el hash — un timeout NO es un pago perdido", hash, "0xJoinLento");
  check("join se firmó una sola vez, nunca dos", joinCalls, 1);
  check("y el hash se guardó — el candado contra el segundo cobro", hashesGuardados, 1);
}

console.log("\n— El recibo del approve tarda: se pregunta a la cadena, no se asume —");
{
  const r1 = await ensureAllowance({
    entryUnits: 1_000_000n,
    feeCurrency: FEE,
    // El permiso NUNCA aparece: cada lectura sigue en 0.
    readAllowance: async () => 0n,
    approve: async () => "0xApproveLento",
    waitApproveReceipt: async () => {
      throw new Error("Timed out");
    },
  });
  check(
    "sin evidencia de que llegó → estado recuperable, NO un fallo genérico",
    r1,
    { kind: "approve_pending", approveHash: "0xApproveLento" }
  );

  let reads = 0;
  const r2 = await ensureAllowance({
    entryUnits: 1_000_000n,
    feeCurrency: FEE,
    // La primera lectura (antes de aprobar) da 0; la segunda (tras el
    // timeout) ya ve el permiso: el approve SÍ llegó, solo el sondeo falló.
    readAllowance: async () => {
      reads++;
      return reads === 1 ? 0n : 1_000_000n;
    },
    approve: async () => "0xApproveLento2",
    waitApproveReceipt: async () => {
      throw new Error("Timed out");
    },
  });
  check("si el permiso SÍ está, sigue igual que si el recibo hubiera llegado", r2, { kind: "ready" });
}

console.log(
  "\n— El retry real: tocar 'pagar' otra vez tras un approve_pending, cuando el approve YA se minó —"
);
{
  // Esto simula las DOS llamadas que hace la pantalla, no una sola con
  // memoria interna: `payAndSit` se vuelve a llamar entera cuando el jugador
  // toca el botón de nuevo, así que `ensureAllowance` arranca de cero cada
  // vez — sin saber que hubo un intento anterior. Lo único que puede probar
  // que el segundo intento no vuelve a aprobar es que la LECTURA de la
  // cadena, no un recuerdo local, sea lo primero que hace.
  let approveCalls = 0;
  let joinCalls = 0;

  // Intento 1: el approve se firma, pero el recibo nunca llega (la app se
  // rinde y muestra "approve_pending" — el jugador espera unos segundos).
  const primerIntento = await ensureAllowance({
    entryUnits: 1_000_000n,
    feeCurrency: FEE,
    readAllowance: async () => 0n, // el permiso todavía no aparece
    approve: async () => {
      approveCalls++;
      return "0xApproveOriginal";
    },
    waitApproveReceipt: async () => {
      throw new Error("Timed out");
    },
  });
  check(
    "el primer intento se rinde con un estado recuperable",
    primerIntento,
    { kind: "approve_pending", approveHash: "0xApproveOriginal" }
  );
  check("y firmó el approve exactamente una vez", approveCalls, 1);

  // Intento 2 ("retry"): llamada NUEVA e independiente. Para entonces el
  // approve original ya se minó de verdad, así que la cadena ya lo ve.
  const segundoIntento = await ensureAllowance({
    entryUnits: 1_000_000n,
    feeCurrency: FEE,
    readAllowance: async () => 1_000_000n, // el original YA está confirmado
    approve: async () => {
      approveCalls++; // si esto se llama, el retry firmó de más
      return "0xApproveDeMas";
    },
    waitApproveReceipt: async () => {},
  });
  check("el retry ve el permiso listo sin volver a aprobar", segundoIntento, { kind: "ready" });
  check(
    "y el approve SIGUE en uno: el retry no pidió una segunda firma",
    approveCalls,
    1
  );

  // Con el permiso listo, lo que sigue es firmar `join` — nunca otro approve.
  const hash = await submitJoin({
    feeCurrency: FEE,
    join: async () => {
      joinCalls++;
      return "0xJoinTrasRetry";
    },
    waitJoinReceipt: async () => {},
    onJoinHash: () => {},
  });
  check("el retry termina en el join, no en otro approve", hash, "0xJoinTrasRetry");
  check("un solo join, como corresponde", joinCalls, 1);
}

console.log(
  "\n— Add Cash en Arena: solo dentro de MiniPay y solo por falta de USDT —"
);
{
  const src = readFileSync(join(ROOT, "components/arena/ArenaSeatPayment.tsx"), "utf8");
  check(
    "reutiliza el deeplink oficial de lib/tokens.ts, no uno propio",
    /import \{ MINIPAY_ADD_CASH \} from "@\/lib\/tokens"/.test(src),
    true
  );
  check(
    "el CTA está condicionado al error de fondos Y a estar dentro de MiniPay",
    src.includes("error === FUNDS_ERROR && inMiniPay"),
    true
  );
  check(
    "el error de fondos es el MISMO que usa el reto diario, no uno propio",
    src.includes('FUNDS_ERROR: MessageKey = "pay.error.insufficient"'),
    true
  );
}

console.log(
  "\n— La política de gas es UNA sola función para el reto diario y la Arena —"
);
{
  const payTs = readFileSync(join(ROOT, "lib/pay.ts"), "utf8");
  const arenaTs = readFileSync(join(ROOT, "lib/arena-join.ts"), "utf8");

  check(
    "el reto diario importa resolveFeeCurrency del módulo compartido",
    /from "\.\/celo-tx"/.test(payTs) && payTs.includes("resolveFeeCurrency"),
    true
  );
  check(
    "la Arena importa la MISMA función, no una copia propia",
    /from "\.\/celo-tx"/.test(arenaTs) && arenaTs.includes("resolveFeeCurrency"),
    true
  );
  check(
    "el gas medido del reto diario (play()) no se tocó",
    payTs.includes("const PLAY_GAS_LIMIT = 150_000n;"),
    true
  );
  check(
    "el feeCurrency se aplica dos veces en la Arena: approve y join",
    (arenaTs.match(/\.\.\.fee,/g) ?? []).length,
    2
  );
  check(
    "y las dos funciones existen en el ABI que firma",
    arenaTs.includes('functionName: "approve"') && arenaTs.includes('functionName: "join"'),
    true
  );
}

console.log("\n— Fuera de MiniPay, el flujo de autenticación anterior no cambia —");
{
  const roomTs = readFileSync(join(ROOT, "components/arena/ArenaRoom.tsx"), "utf8");
  check(
    "la pantalla decide con la función pura, no con un ternario propio",
    roomTs.includes("seatEntryGateFor({") && roomTs.includes('entryGate === "needs_login"'),
    true
  );
  const needsLoginAt = roomTs.indexOf('entryGate === "needs_login"');
  const paySeatAt = roomTs.indexOf('entryGate === "pay_seat"');
  const needsLoginBranch = roomTs.slice(needsLoginAt, paySeatAt);
  check(
    "AccessCard sigue siendo la salida de needs_login — no se borró ni se saltó",
    needsLoginAt > -1 && paySeatAt > needsLoginAt && needsLoginBranch.includes("<AccessCard />"),
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
