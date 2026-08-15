// La ventana entre "el contrato ya cobró" y "el recibo está guardado" — CERRADA.
//
// Caso que la motivó (2026-08-15): la jugada `0xcb14efdd0b…` de MiniPay quedó
// cobrada en la cadena (mazo 15, 0.10 USDT al pozo) y nunca llegó al servidor.
// El candado de `pendingPlay()` no se activó nunca —el jugador siguió jugando
// después— así que el recibo tampoco estaba en la bandeja del teléfono. Hubo
// que reponerla a mano desde el evento (`scripts/recover-play.ts`).
//
// La causa era de ORDEN: el recibo se guardaba al volver a `handleStart`, o sea
// después de esperar el recibo de la cadena — hasta `RECEIPT_TIMEOUT_MS`. En ese
// intervalo la entrada estaba cobrada y el dispositivo no lo sabía.
//
// Ahora se guarda desde `onHash`, dentro de `playForDeck`, en el instante en que
// la wallet transmite. Esta prueba exige que siga siendo así: CERO `await` entre
// obtener el hash y persistirlo.
//
// Correr: node scripts/verify-play-receipt-window.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RECEIPT_TIMEOUT_MS } from "../lib/celo-tx.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

const pay = readFileSync(join(ROOT, "lib/pay.ts"), "utf8").replace(/\r\n/g, "\n");
const shell = readFileSync(join(ROOT, "components/GameShell.tsx"), "utf8").replace(
  /\r\n/g,
  "\n"
);
const outbox = readFileSync(join(ROOT, "lib/outbox.ts"), "utf8").replace(/\r\n/g, "\n");

/* ── El modelo, con el guardado en su sitio nuevo ────────────────────────── */

type Muerte =
  | "antes-de-firmar"
  /** La wallet transmitió: el hash existe y el contrato YA cobró. */
  | "hash-en-mano"
  /** Durante la espera del recibo de la cadena. */
  | "esperando-recibo"
  | "nunca";

interface Resultado {
  cobrado: boolean;
  guardado: string | null;
}

/** La secuencia de `playForDeck` tal como queda tras el arreglo. */
function cobrarYGuardar(muereEn: Muerte): Resultado {
  const disco: { hash?: string } = {};
  let cobrado = false;

  if (muereEn === "antes-de-firmar") return { cobrado, guardado: null };

  // writeContractAsync resolvió: transmitida y cobrada.
  const hash = "0xcb14…";
  cobrado = true;

  // onHash(...) — síncrono, sin ningún await de por medio.
  disco.hash = hash;

  if (muereEn === "hash-en-mano") return { cobrado, guardado: disco.hash ?? null };
  // await waitForTransactionReceipt(...)
  if (muereEn === "esperando-recibo") return { cobrado, guardado: disco.hash ?? null };

  return { cobrado, guardado: disco.hash ?? null };
}

/* ── 1. Morir en cualquier punto ya no cuesta una entrada ────────────────── */

console.log("\n— 1. Matar la app en cada punto de la secuencia —\n");

{
  const antes = cobrarYGuardar("antes-de-firmar");
  ok(
    "morir antes de firmar: no se cobró, no se perdió nada",
    !antes.cobrado && antes.guardado === null
  );

  for (const momento of ["hash-en-mano", "esperando-recibo", "nunca"] as const) {
    const r = cobrarYGuardar(momento);
    ok(
      `morir ${momento}: cobrado Y guardado → se recupera al reabrir`,
      r.cobrado && r.guardado !== null,
      JSON.stringify(r)
    );
  }
}

/* ── 2. CERO awaits entre el hash y su persistencia ──────────────────────── */

console.log("\n— 2. La ventana: cero `await` entre cobrar y guardar —\n");

{
  const firma = pay.indexOf("const playHash = await writeContractAsync({");
  ok("el cobro sale de `writeContractAsync`", firma !== -1);

  // El final de esa llamada: el primer `});` después de abrirla.
  const finFirma = pay.indexOf("});", firma);
  ok("se localiza el final de la llamada que cobra", finFirma > firma);

  const guardado = pay.indexOf("onHash(playHash, account.toLowerCase())", finFirma);
  ok(
    "el hash se persiste con `onHash`, dentro de `playForDeck`",
    guardado !== -1,
    "si se guarda fuera, vuelve a haber ventana"
  );

  /**
   * Sin comentarios: lo que cuenta es el código que se EJECUTA. Los comentarios
   * de esa zona hablan justamente de no poner ningún `await`, y contarlos daría
   * un falso positivo — el primer intento de esta prueba cayó ahí.
   */
  const sinComentarios = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const ventana = sinComentarios(pay.slice(finFirma + 3, guardado));
  const awaits = (ventana.match(/\bawait\b/g) ?? []).length;
  ok(
    "CERO `await` entre obtener el hash y guardarlo",
    awaits === 0,
    `hay ${awaits}:\n${ventana}`
  );

  // Y el guardado va ANTES de la espera del recibo, que es lo que lo retrasaba.
  const espera = pay.indexOf("waitForTransactionReceipt", finFirma);
  ok(
    "y se guarda ANTES de esperar el recibo de la cadena",
    guardado < espera,
    `guardado en ${guardado}, espera en ${espera}`
  );

  ok(
    "`onHash` está declarado como síncrono (no devuelve promesa)",
    /onHash: \(txHash: string, player: string\) => void/.test(pay),
    "si pudiera ser async, quien lo implemente reabriría la ventana"
  );

  ok(
    "guardar no puede tumbar la jugada (va envuelto en try/catch)",
    /try \{\s*onHash\(playHash, account\.toLowerCase\(\)\);\s*\} catch \{/.test(pay)
  );

  console.log(
    `\n  → La entrada queda escrita en el dispositivo en el mismo instante en\n` +
      `    que el contrato cobra. La espera del recibo (${RECEIPT_TIMEOUT_MS / 1000}s) ya no\n` +
      `    tiene nada que perder.\n`
  );
}

/* ── 3. Lo que NO se tocó ────────────────────────────────────────────────── */

console.log("— 3. Reglas de cobro y validación, intactas —\n");

{
  ok(
    "sigue firmando con la dirección confirmada y explícita",
    /account,\n\s+address: pot,/.test(pay)
  );
  ok(
    "sigue re-comprobando la cuenta pegado a la firma",
    /await assertSameAccount\(\);\n\s+const playHash/.test(pay)
  );
  ok(
    "la espera del recibo sigue con tope y sin cancelar la jugada",
    /timeout: RECEIPT_TIMEOUT_MS/.test(pay) &&
      /\} catch \{\s*\/\/ Sigue adelante con el hash/.test(pay)
  );
  ok(
    "`ensureWalletSession` sigue corriendo tras la jugada, sin esperarse",
    /void ensureWalletSession\(account, playHash\);/.test(pay)
  );
  ok(
    "el guardián sigue decidiendo antes de cobrar",
    /const decision = decidePlayStart\(\{/.test(shell) &&
      shell.indexOf("decidePlayStart({") < shell.indexOf("await playForDeck(")
  );
  ok(
    "y la identidad se sigue validando antes de firmar",
    shell.indexOf("checkAliasBeforePaying(") < shell.indexOf("await playForDeck(")
  );
}

/* ── 4. Sin duplicados: la bandeja sigue siendo idempotente ──────────────── */

console.log("\n— 4. Guardar dos veces el mismo hash no duplica nada —\n");

{
  /** El `enqueue` real: mismo `id` ⇒ devuelve el que ya estaba. */
  ok(
    "`enqueue` devuelve el envío existente cuando el id se repite",
    /const existing = items\.find\(\(it\) => it\.id === id\);\s*\n\s*if \(existing\) return existing;/.test(
      outbox
    )
  );
  ok(
    "el id se construye con el txHash, así que es uno por jugada",
    /enqueue\(`play:\$\{hash\}`, "\/api\/plays"/.test(shell)
  );
  ok(
    "`handleStart` recoge el envío ya guardado en vez de crear otro",
    /const receipt = guardar\(txHash, player\);/.test(shell)
  );

  // Simulación del doble guardado (onHash + el de handleStart).
  const bandeja: Array<{ id: string; body: unknown }> = [];
  const enqueueFalso = (id: string, body: unknown) => {
    const existe = bandeja.find((x) => x.id === id);
    if (existe) return existe;
    const nuevo = { id, body };
    bandeja.push(nuevo);
    return nuevo;
  };
  const a = enqueueFalso("play:0xabc", { deckSize: 10 });
  const b = enqueueFalso("play:0xabc", { deckSize: 10 });
  ok("guardar dos veces deja UNA sola entrada", bandeja.length === 1);
  ok("y las dos llamadas devuelven el mismo envío", a === b);
}

/* ── 5. Gratis y pagada, MiniPay y Rabby: el mismo camino ────────────────── */

console.log("\n— 5. Un solo camino para todos los casos —\n");

{
  /**
   * `onHash` va después de la firma y antes de todo lo demás, sin mirar
   * `wasFree` ni si estamos en MiniPay: el guardado no puede depender del tipo
   * de entrada ni del entorno, porque el cobro ya ocurrió en los cuatro casos.
   */
  const firma = pay.indexOf("const playHash = await writeContractAsync({");
  const guardado = pay.indexOf("onHash(playHash", firma);
  const tramo = pay.slice(firma, guardado);
  ok(
    "guardar no depende de si la jugada fue gratis o pagada",
    !/wasFree/.test(tramo),
    tramo
  );
  ok(
    "ni de estar dentro de MiniPay",
    !/[mM]iniPay/.test(tramo) && !/inMiniPay/.test(tramo)
  );
  ok(
    "la rama de allowance (solo pagadas) queda ANTES de la firma",
    pay.indexOf("if (allowance < FEE_AMOUNT)") < firma
  );
}

/* ── 6. Una transacción revertida no se convierte en jugada ──────────────── */

console.log("\n— 6. Guardar el hash NO es dar la jugada por buena —\n");

{
  /**
   * Lo que se guarda es un hash, no una jugada válida. Quien decide si vale es
   * el servidor, releyendo la cadena: `verifyPlayTx` exige recibo `success` y un
   * evento `Played` emitido por NUESTRO contrato. Una transacción revertida no
   * emite ese evento, así que nunca puede registrarse.
   */
  const onchain = readFileSync(join(ROOT, "lib/onchain.ts"), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  ok(
    "el servidor exige que la transacción haya sido exitosa",
    /receipt\.status !== "success"/.test(onchain)
  );
  ok(
    "y que el evento lo emita el contrato del pozo",
    /l\.address\.toLowerCase\(\) === AVISPATE_POT_ADDRESS/.test(onchain)
  );
  ok(
    "`/api/plays` no escribe nada si esa verificación falla",
    /if \(!check\.ok \|\| !check\.player\)\s*\n\s*return NextResponse\.json\(\{ error: "invalid_payment" \}/.test(
      readFileSync(join(ROOT, "app/api/plays/route.ts"), "utf8").replace(/\r\n/g, "\n")
    )
  );
  ok(
    "guardar en la bandeja no toca la cadena ni valida nada",
    !/verifyPlayTx|getTransactionReceipt/.test(outbox)
  );
}

/* ── 7. Y si la app muere, al volver se recupera ─────────────────────────── */

console.log("\n— 7. Al reabrir: o se registra solo, o el botón lo dice —\n");

{
  ok(
    "al montar se mira si quedó una jugada pagada sin registrar",
    /const left = pendingPlay\(\);\s*\n\s*if \(left\) setPayBlock\(\{ kind: "resume_pending", pending: left \}\);/.test(
      shell
    )
  );
  ok(
    "y ese estado convierte el botón en \"terminar de registrar\"",
    /blockedByPending/.test(
      readFileSync(join(ROOT, "lib/lobby-cta.ts"), "utf8")
    )
  );
  ok(
    "además la bandeja se vacía sola al abrir la app",
    /flushOutbox\(\)/.test(
      readFileSync(join(ROOT, "components/OutboxBridge.tsx"), "utf8")
    )
  );
  ok(
    "un recibo pendiente sobrevive hasta 48 h en el dispositivo",
    /MAX_AGE_MS = 48 \* 60 \* 60 \* 1000/.test(outbox)
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
