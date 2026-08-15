// La ventana entre "el contrato ya cobró" y "el recibo está guardado".
//
// Caso que la motivó (2026-08-15): la jugada `0xcb14efdd0b…` de MiniPay quedó
// cobrada en la cadena (mazo 15, 0.10 USDT al pozo) y nunca llegó al servidor.
// El candado de `pendingPlay()` no se activó nunca —el jugador siguió jugando
// después— así que el recibo tampoco estaba en la bandeja del teléfono. Hubo
// que reponerla a mano desde el evento (`scripts/recover-play.ts`).
//
// Esto NO reproduce aquel incidente: nadie puede saber si la webview se cerró.
// Lo que hace es más barato y más fuerte — demuestra que la pérdida es POSIBLE,
// y lo hace sin gastar una entrada real:
//
//   1. modela la secuencia del cobro con un punto de muerte inyectable;
//   2. mata el proceso en cada punto y mira qué queda guardado;
//   3. y comprueba contra el CÓDIGO REAL que la secuencia modelada es la que
//      hay, para que el modelo no pueda mentir.
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

/* ── El modelo ───────────────────────────────────────────────────────────── */

/**
 * Dónde se muere la pestaña (o la webview de MiniPay, que se suspende sola
 * mientras enseña la hoja de firma — lo dice el comentario de
 * `RECEIPT_TIMEOUT_MS` en `lib/celo-tx.ts`).
 */
type Muerte =
  /** Antes de firmar: no se cobró nada, no hay nada que perder. */
  | "antes-de-firmar"
  /** La wallet acaba de transmitir: el hash existe, el contrato YA cobró. */
  | "hash-en-mano"
  /** Durante la espera del recibo, que dura hasta RECEIPT_TIMEOUT_MS. */
  | "esperando-recibo"
  /** Ya se guardó en la bandeja. */
  | "nunca";

interface Resultado {
  /** El contrato cobró: esto no se deshace. */
  cobrado: boolean;
  /** Lo que quedó escrito en el dispositivo. */
  guardado: string | null;
}

/**
 * La secuencia de `playForDeck` + `handleStart`, tal como está hoy.
 * Abajo se comprueba contra el archivo real que es esta y no otra.
 */
function cobrarYGuardar(muereEn: Muerte): Resultado {
  const almacenamiento: { hash?: string } = {};
  let cobrado = false;

  // lib/pay.ts — writeContractAsync: la wallet transmite y el contrato cobra.
  if (muereEn === "antes-de-firmar") {
    return { cobrado, guardado: almacenamiento.hash ?? null };
  }
  const hash = "0xcb14…";
  cobrado = true;

  if (muereEn === "hash-en-mano") {
    return { cobrado, guardado: almacenamiento.hash ?? null };
  }

  // lib/pay.ts — await waitForTransactionReceipt(...). Aquí se puede estar
  // hasta RECEIPT_TIMEOUT_MS, y el hash solo vive en una variable local.
  if (muereEn === "esperando-recibo") {
    return { cobrado, guardado: almacenamiento.hash ?? null };
  }

  // components/GameShell.tsx — enqueue(): recién ahora toca el disco.
  almacenamiento.hash = hash;
  return { cobrado, guardado: almacenamiento.hash ?? null };
}

/* ── 1. Qué se pierde y cuándo ───────────────────────────────────────────── */

console.log("\n— 1. Matar la app en cada punto de la secuencia —\n");

{
  const antes = cobrarYGuardar("antes-de-firmar");
  ok(
    "morir antes de firmar: no se cobró, no se perdió nada",
    !antes.cobrado && antes.guardado === null,
    JSON.stringify(antes)
  );

  const enMano = cobrarYGuardar("hash-en-mano");
  ok(
    "morir con el hash en la mano: COBRADO y sin rastro en el teléfono",
    enMano.cobrado && enMano.guardado === null,
    JSON.stringify(enMano)
  );

  const esperando = cobrarYGuardar("esperando-recibo");
  ok(
    "morir esperando el recibo: COBRADO y sin rastro en el teléfono",
    esperando.cobrado && esperando.guardado === null,
    JSON.stringify(esperando)
  );

  const completo = cobrarYGuardar("nunca");
  ok(
    "llegar al final: cobrado Y guardado (se recupera solo al reabrir)",
    completo.cobrado && completo.guardado !== null,
    JSON.stringify(completo)
  );
}

/* ── 2. Cuánto dura la ventana ───────────────────────────────────────────── */

console.log("\n— 2. El tamaño de la ventana —\n");

{
  ok(
    "la espera del recibo tiene tope, no es infinita",
    RECEIPT_TIMEOUT_MS > 0 && RECEIPT_TIMEOUT_MS <= 60_000,
    `${RECEIPT_TIMEOUT_MS}ms`
  );
  console.log(
    `\n  → La ventana en la que una entrada cobrada no está guardada dura\n` +
      `    hasta ${RECEIPT_TIMEOUT_MS / 1000} segundos (RECEIPT_TIMEOUT_MS).\n`
  );
}

/* ── 3. Y el código real hace exactamente esto ───────────────────────────── */

console.log("— 3. El modelo no miente: así está el código hoy —\n");

{
  const pay = readFileSync(join(ROOT, "lib/pay.ts"), "utf8").replace(/\r\n/g, "\n");
  const shell = readFileSync(join(ROOT, "components/GameShell.tsx"), "utf8").replace(
    /\r\n/g,
    "\n"
  );

  // El instante en que el contrato cobra.
  const firma = pay.indexOf("const playHash = await writeContractAsync({");
  ok("el cobro sale de `writeContractAsync`", firma !== -1);

  // El instante en que `playForDeck` devuelve el hash a quien lo llamó.
  const devuelve = pay.indexOf("return { txHash: playHash", firma);
  ok("y `playForDeck` devuelve ese hash", devuelve !== -1);

  /**
   * La ventana empieza DESPUÉS de que `writeContractAsync` haya resuelto — es
   * decir, en `onStage("confirming")`. Medir desde la línea de la firma
   * incluiría su propio `await` y contaría uno de más.
   */
  const yaCobrado = pay.indexOf('onStage("confirming")', firma);
  ok("la ventana empieza justo después de firmar", yaCobrado > firma);
  const entreMedias =
    yaCobrado !== -1 && devuelve !== -1 ? pay.slice(yaCobrado, devuelve) : "";

  /**
   * LO QUE ESTA PRUEBA DEMUESTRA.
   *
   * Si entre "el contrato cobró" y "el hash sale de la función" hay siquiera un
   * `await`, entonces existe un intervalo real —no teórico— en el que la
   * entrada está pagada y el teléfono no lo sabe. Cerrar la app ahí la pierde,
   * exactamente como en el modelo de arriba.
   */
  const awaits = (entreMedias.match(/\bawait\b/g) ?? []).length;
  ok(
    "hay al menos un `await` entre el cobro y la devolución del hash",
    awaits > 0,
    "si no lo hubiera, no habría ventana que cerrar"
  );
  console.log(`         (hoy hay ${awaits}: la espera del recibo)`);

  ok(
    "esa espera es `waitForTransactionReceipt`, con su tope",
    /await publicClient\.waitForTransactionReceipt\(\{/.test(entreMedias) &&
      /RECEIPT_TIMEOUT_MS/.test(entreMedias)
  );

  // Y el guardado ocurre DESPUÉS, ya fuera de `playForDeck`.
  const llamada = shell.indexOf("await playForDeck(");
  const guardado = shell.indexOf("enqueue(`play:${txHash}`", llamada);
  ok("el recibo se guarda en `GameShell`, con `enqueue`", guardado !== -1);
  ok(
    "y se guarda DESPUÉS de que `playForDeck` haya terminado",
    llamada !== -1 && guardado > llamada,
    "si se guardara antes, no habría nada que demostrar"
  );

  ok(
    "el guardado sí es síncrono una vez que llega (no espera a la red)",
    /const receipt = enqueue\(`play:\$\{txHash\}`/.test(shell),
    "`enqueue` escribe en localStorage antes de cualquier await, y eso está bien"
  );
}

/* ── 4. Lo que haría falta para cerrarla ─────────────────────────────────── */

console.log("\n— 4. Qué tendría que cambiar (todavía NO está hecho) —\n");

{
  /**
   * El arreglo es de ORDEN, no de lógica: escribir el hash en el dispositivo
   * en el mismo instante en que existe, antes de esperar nada. Es la regla que
   * la propia bandeja ya se pone ("SÍNCRONO a propósito: se llama antes de
   * cualquier await", `lib/outbox.ts`) — solo que hoy se cumple un `await`
   * demasiado tarde.
   *
   * Cuando se aplique, este bloque pasa a exigir lo contrario: cero `await`
   * entre el cobro y el guardado. Mientras tanto queda escrito aquí para que
   * el riesgo no se pierda de vista.
   */
  const pay = readFileSync(join(ROOT, "lib/pay.ts"), "utf8");
  const yaArreglado = /enqueue\(/.test(pay);
  ok(
    "AVISO: la ventana sigue abierta (riesgo conocido, sin arreglar)",
    !yaArreglado,
    "si `pay.ts` ya guarda el recibo, actualiza esta prueba para exigir 0 awaits"
  );
  console.log(
    "\n  → Riesgo abierto: una entrada cobrada puede perderse si la app muere\n" +
      "    en esa ventana. Documentado, no arreglado. Ver commit de recuperación.\n"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
