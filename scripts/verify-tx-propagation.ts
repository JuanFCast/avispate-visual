// Un hash NO es una transacción, y el 2026-08-26 la app las confundió.
//
// La wallet embebida de Privy devolvía un hash de algo que nunca difundió: la
// espera del recibo se agotaba en silencio, la pantalla pasaba igual a
// "Registrando jugada…", y el envío se quedaba 48 h reintentándose contra una
// transacción que la cadena nunca vio.
//
// Dos frenos, y este archivo comprueba los dos:
//
//   1. No mandarle CIP-64 a quien no sabe firmarla (`walletSupportsFeeCurrency`
//      + `shortOfGas`). Es la CAUSA: sin CELO y con `feeCurrency` descartado por
//      la wallet, lo que se firma es una transacción que la red rechaza.
//   2. No anunciar "Registrando jugada…" sin que la red haya visto el hash
//      (`probeTxPresence` en `playForDeck`). Es la RED DE SEGURIDAD, para
//      cualquier wallet que haga lo mismo y todavía no conozcamos.
//
// El cableado se comprueba sobre el código fuente: `playForDeck` es un hook de
// wagmi y firmar de verdad no se puede recorrer aquí. Lo que sí se recorre es la
// regla pura de cuándo la red "vio" algo.
//
// Correr: node scripts/verify-tx-propagation.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideTxPresence } from "../lib/tx-presence.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

let failed = 0;
function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/* ── 1. La causa: nadie firma CIP-64 sin saber hacerlo ───────────────────── */

console.log("\n— 1. La capacidad de la wallet llega a la decisión del gas —\n");

{
  const celoTx = leer("lib/celo-tx.ts");
  ok(
    "`walletSupportsFeeCurrency` nombra a la embebida y la deja fuera",
    /export function walletSupportsFeeCurrency/.test(celoTx) &&
      /connectorName !== EMBEDDED_WALLET_NAME/.test(celoTx),
    "la excepción tiene que ser por nombre, no por adivinanza"
  );
  ok(
    "sin CELO y sin CIP-64 se devuelve `shortOfGas`, no un feeCurrency",
    /shortOfGas: true/.test(celoTx) &&
      celoTx.indexOf("if (supportsFeeCurrency)") <
        celoTx.indexOf("shortOfGas: true"),
    "el feeCurrency solo puede salir por la rama que comprueba la capacidad"
  );

  // Los TRES sitios que firman con gas tienen que pasar la capacidad. Si
  // mañana aparece un cuarto, este cheque lo caza.
  for (const [archivo, ruta] of [
    ["el reto diario", "lib/pay.ts"],
    ["la Arena", "lib/arena-join.ts"],
    ["el envío de tokens", "components/wallet/SendModal.tsx"],
  ] as const) {
    const src = leer(ruta);
    ok(
      `${archivo} pasa la capacidad de la wallet a resolveFeeCurrency`,
      /walletSupportsFeeCurrency\(connector\?\.name\)/.test(src),
      `${ruta} llama a resolveFeeCurrency sin decir si la wallet sabe CIP-64`
    );
    ok(
      `${archivo} se para si no hay con qué pagar el gas`,
      /shortOfGas/.test(src),
      `${ruta} ignora shortOfGas y firmaría igual`
    );
  }

  const pay = leer("lib/pay.ts");
  ok(
    "el reto diario se para ANTES de firmar",
    pay.indexOf("if (feeCurrency.shortOfGas)") < pay.indexOf("writeContractAsync({"),
    "el freno tiene que llegar con la plata todavía dentro"
  );

  /**
   * Y que los tres digan que falta CELO, no "no tienes saldo".
   *
   * En la Arena esto falló de verdad: el error viajaba como texto
   * (`insufficient_gas_celo`) y lo cazaba antes el `/insufficient/` genérico,
   * que manda a recargar USDT — el token equivocado, y encima el que sí tiene.
   * Es el mismo error que ya documenta `MissingFunds` en `pay.ts`: un mensaje
   * único para todo lo que dice "insufficient" acusa siempre al mismo token.
   */
  ok(
    "el reto diario traduce la carencia a 'falta CELO'",
    /gas_celo.*\n.*pay\.error\.fee_celo|if \(err\.missing === "gas_celo"\) return "pay\.error\.fee_celo";/.test(
      leer("components/GameShell.tsx")
    ),
    "GameShell no distingue gas_celo de la falta de USDT"
  );
  {
    const arena = leer("lib/arena-join.ts");
    ok(
      "la Arena traduce la carencia a 'falta CELO'",
      // Ya no por texto: la carencia viaja con su tipo (como en el reto
      // diario) y se traduce antes de mirar ningún error de la wallet.
      arena.includes('throw new InsufficientFundsError("gas_celo")') &&
        /if \(e\.missing === "gas_celo"\) return "pay\.error\.fee_celo";/.test(arena) &&
        arena.indexOf('e.missing === "gas_celo"') <
          arena.indexOf("classifyTxError(e)"),
      "la Arena tiene que lanzar InsufficientFundsError('gas_celo') y traducirlo antes que los errores de la wallet"
    );
  }
  {
    const send = leer("components/wallet/SendModal.tsx");
    const desdeCorte = send.slice(send.indexOf("if (feeCurrency.shortOfGas)"));
    ok(
      "el envío de tokens dice 'falta CELO' y devuelve el formulario",
      /setError\("pay\.error\.fee_celo"\)/.test(desdeCorte.slice(0, 300)) &&
        /setPhase\("form"\)/.test(desdeCorte.slice(0, 300)),
      "sin volver a 'form' el modal se queda en 'enviando' para siempre"
    );
  }
}

/* ── 2. La red de seguridad: el hash no basta ────────────────────────────── */

console.log("\n— 2. No se anuncia 'registrando' sin que la red lo haya visto —\n");

{
  const pay = leer("lib/pay.ts");
  ok(
    "`playForDeck` sondea la presencia cuando se agota la espera del recibo",
    /presence = await probeTxPresence\(playHash\)/.test(pay),
    "sin esto, un recibo que no llega se trata igual que uno que sí"
  );
  ok(
    // Contra la LLAMADA, no contra la palabra: `probeTxPresence` aparece antes
    // en la línea del import y eso hacía pasar la comprobación por el motivo
    // equivocado (aquí falló por el contrario, que es como se notó).
    "y el sondeo va DESPUÉS de guardar el recibo en la bandeja",
    pay.indexOf("onHash(playHash") < pay.indexOf("await probeTxPresence("),
    "guardar primero no es negociable: si el dinero salió, tiene que quedar escrito"
  );
  ok(
    "la presencia sale en el resultado, no se decide dentro",
    /presence: TxPresence;/.test(pay) && /presence,\n      \};/.test(pay),
    "quien pinta la pantalla es quien decide qué enseñar"
  );

  const shell = leer("components/GameShell.tsx");
  ok(
    'GameShell corta antes de "Registrando jugada…" si la red no la vio',
    shell.indexOf('if (presence === "unknown")') <
      shell.indexOf('setPayStage("registering")'),
    "el corte tiene que ir antes de anunciar el registro"
  );
  ok(
    "y ese corte NO borra el envío ni permite otro cobro",
    /applyRegisterOutcome\(\{ result: "retry", error: "payment_unknown" \}/.test(
      shell
    ),
    "tiene que entrar por la misma regla que todo lo demás (pending-fate)"
  );

  const outbox = leer("lib/outbox.ts");
  ok(
    "guardar en la bandeja sigue sin tocar la cadena",
    !/probeTxPresence|getTransactionReceipt/.test(outbox)
  );
}

/* ── 3. Y un nodo lento nunca puede cancelar una jugada ──────────────────── */

console.log("\n— 3. Hace falta consenso para cortar —\n");

{
  ok(
    "un solo nodo diciendo que no la tiene NO corta",
    decideTxPresence(["unknown", "unreachable", "unreachable"]) !== "unknown"
  );
  ok(
    "dos que la niegan sí",
    decideTxPresence(["unknown", "unknown", "unreachable"]) === "unknown"
  );
  ok(
    "y si UNO la conoce, no se corta aunque otros dos la nieguen",
    decideTxPresence(["known", "unknown", "unknown"]) === "pending"
  );
  ok(
    "ni aunque la tenga minada uno solo",
    decideTxPresence(["receipt", "unknown", "unknown"]) === "mined"
  );

  // El cliente y el servidor preguntan con el MISMO módulo: si un día uno de
  // los dos se hace su propia versión, dejan de coincidir en qué existe.
  const probe = leer("lib/tx-probe.ts");
  ok(
    "cliente y servidor comparten el sondeo",
    /from "\.\/tx-probe"/.test(leer("lib/onchain.ts")) &&
      /from "\.\/tx-probe"/.test(leer("lib/pay.ts")) &&
      /decideTxPresence/.test(probe)
  );
  ok(
    "y el sondeo pregunta a cada nodo por separado, no por el fallback de viem",
    /CELO_RPC_URLS\.map/.test(probe) && !/CELO_TRANSPORT/.test(probe),
    "el fallback de viem no distingue 'no lo tengo' de 'no contesto'"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
