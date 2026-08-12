// Verifica `lib/celo-tx.ts`, la política de gas compartida entre el reto
// diario (`pay.ts`), la Arena (`arena-join.ts`) y el envío de tokens del
// perfil (`SendModal.tsx`). Nació de extraer una función que antes vivía
// solo en `pay.ts` — este archivo es la red que evita que esa extracción
// haya cambiado el comportamiento para cualquiera de los tres, en silencio.
//
// Correr: node scripts/verify-celo-tx.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveFeeCurrency,
  GAS_SAFETY,
  RECEIPT_TIMEOUT_MS,
  type BalanceReader,
} from "../lib/celo-tx.ts";
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

const ADDR = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18" as `0x${string}`;
const FEE = { feeCurrency: CIP64_FEE_ADAPTER as `0x${string}` };

console.log("\n— MiniPay manda SIEMPRE, sin importar el saldo de CELO —");
{
  const forrado: BalanceReader = {
    getBalance: async () => 10n ** 30n, // una fortuna en CELO
    getGasPrice: async () => 1n,
  };
  check(
    "hasta con CELO de sobra, dentro de MiniPay paga en USDT",
    await resolveFeeCurrency(forrado, ADDR, 100_000n, true),
    FEE
  );
}

console.log("\n— Fuera de MiniPay: se conserva la decisión CELO/USDT de antes —");
{
  // needed = gasLimit * gasPrice * GAS_SAFETY / 4  →  con estos números, un
  // límite exacto y redondo para fijar el borde sin ambigüedad.
  const gasLimit = 100_000n;
  const gasPrice = 1_000_000_000n; // 1 gwei
  const needed = (gasLimit * gasPrice * GAS_SAFETY) / 4n; // 125_000_000_000_000n

  const clienteCon = (balance: bigint): BalanceReader => ({
    getBalance: async () => balance,
    getGasPrice: async () => gasPrice,
  });

  check(
    "justo en el borde (== needed) todavía alcanza para pagar en CELO",
    await resolveFeeCurrency(clienteCon(needed), ADDR, gasLimit, false),
    {}
  );
  check(
    "un wei por debajo del borde ya cae a USDT",
    await resolveFeeCurrency(clienteCon(needed - 1n), ADDR, gasLimit, false),
    FEE
  );
  check(
    "con CELO de sobra, paga en CELO",
    await resolveFeeCurrency(clienteCon(needed * 10n), ADDR, gasLimit, false),
    {}
  );
  check(
    "sin nada de CELO, cae a USDT",
    await resolveFeeCurrency(clienteCon(0n), ADDR, gasLimit, false),
    FEE
  );
}

console.log("\n— El adaptador es el de USDT (6 decimales) importado de contracts.ts, no uno suelto —");
{
  const contractsTs = readFileSync(join(ROOT, "lib/contracts.ts"), "utf8");
  const celoTxTs = readFileSync(join(ROOT, "lib/celo-tx.ts"), "utf8");
  check(
    "celo-tx.ts IMPORTA CIP64_FEE_ADAPTER, no lo redeclara con su propia dirección",
    celoTxTs.includes("import { CIP64_FEE_ADAPTER }") && !/const CIP64_FEE_ADAPTER\s*=/.test(celoTxTs),
    true
  );
  check(
    "y en contracts.ts sigue siendo el adaptador de USDT, documentado como tal",
    contractsTs.includes(
      'export const CIP64_FEE_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";'
    ) && /Adaptador CIP-64 para pagar gas en USDT/.test(contractsTs),
    true
  );
}

console.log("\n— GAS_SAFETY y RECEIPT_TIMEOUT_MS no cambiaron de valor al mudarse —");
{
  // Estos dos vivían sueltos en pay.ts antes de la extracción. Un cambio de
  // valor aquí cambiaría el umbral CELO/USDT o la paciencia con un recibo
  // lento para los TRES consumidores a la vez, sin que nadie lo pidiera.
  check("GAS_SAFETY sigue siendo 5n (→ margen x1.25)", GAS_SAFETY === 5n, true);
  check("RECEIPT_TIMEOUT_MS sigue siendo 20 s", RECEIPT_TIMEOUT_MS, 20_000);
}

console.log("\n— Los tres consumidores importan la MISMA función, ninguno tiene copia propia —");
{
  const files = {
    "lib/pay.ts": readFileSync(join(ROOT, "lib/pay.ts"), "utf8"),
    "lib/arena-join.ts": readFileSync(join(ROOT, "lib/arena-join.ts"), "utf8"),
    "components/wallet/SendModal.tsx": readFileSync(
      join(ROOT, "components/wallet/SendModal.tsx"),
      "utf8"
    ),
  };
  for (const [name, src] of Object.entries(files)) {
    check(
      `${name} importa resolveFeeCurrency de celo-tx, no lo redefine`,
      /resolveFeeCurrency/.test(src) &&
        /from ["'][^"']*celo-tx["']/.test(src) &&
        !/^(export )?(async )?function resolveFeeCurrency/m.test(src),
      true
    );
  }
  // pay.ts y arena-join.ts pasan su propio límite de gas (medido o
  // conservador); SendModal conserva el mismo 150_000n que usaba de forma
  // implícita antes de que el parámetro existiera — comportamiento idéntico.
  check(
    "SendModal.tsx sigue usando el mismo límite de gas que antes (150_000n), sin uno nuevo inventado",
    (files["components/wallet/SendModal.tsx"].match(/resolveFeeCurrency\(/g) ?? []).length === 2 &&
      (files["components/wallet/SendModal.tsx"].match(/150_000n/g) ?? []).length === 2,
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
