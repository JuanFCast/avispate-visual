// Verifica `lib/tx-errors.ts`: que el tipo de fallo salga del CÓDIGO del error
// y no del texto, como exige MiniPay. Usa los errores reales de viem, envueltos
// igual que llegan desde wagmi, y un mensaje en español que el clasificador
// viejo (que buscaba "rejected" en el texto) no reconocía.
//
// Correr: node scripts/verify-tx-errors.ts
import {
  BaseError,
  ChainMismatchError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from "viem";
import { celo } from "viem/chains";
import { classifyTxError } from "../lib/tx-errors.ts";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FALLA"} ${name}${ok ? "" : ` → ${actual}, esperaba ${expected}`}`);
}

/** Como lo entrega wagmi: el error de la wallet, dentro de uno de viem. */
function wrapped(inner: Error): Error {
  return new BaseError("Transaction failed.", { cause: inner });
}

// La wallet en español: el texto no dice "rejected" en ninguna parte.
const enEspanol = Object.assign(new Error("El usuario canceló la solicitud"), {
  code: 4001,
});
check("4001 con texto en español", classifyTxError(enEspanol), "rejected");
check(
  "UserRejectedRequestError envuelto",
  classifyTxError(wrapped(new UserRejectedRequestError(new Error("x")))),
  "rejected"
);
check(
  "falta moneda nativa para la tarifa",
  classifyTxError(wrapped(new InsufficientFundsError({ cause: new BaseError("x") }))),
  "fee_native"
);
check(
  "otra red",
  classifyTxError(
    wrapped(new ChainMismatchError({ chain: celo, currentChainId: 1 }))
  ),
  "chain"
);
check("4902: red desconocida", classifyTxError({ code: 4902 }), "chain");
check(
  "el ERC-20 dice que no alcanza el saldo",
  classifyTxError(
    wrapped(
      Object.assign(new Error("reverted"), {
        name: "ContractFunctionRevertedError",
        data: { errorName: "ERC20InsufficientBalance" },
      })
    )
  ),
  "insufficient"
);
// Lo que antes se adivinaba por el texto ya no se adivina: sin código, no se
// inventa la causa.
check(
  "texto con 'insufficient' pero sin código",
  classifyTxError(new Error("insufficient something")),
  "unknown"
);
check("nada", classifyTxError(undefined), "unknown");
check("una cadena", classifyTxError("rejected"), "unknown");

if (failed) {
  console.log(`\n${failed} caso(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodo bien.");
