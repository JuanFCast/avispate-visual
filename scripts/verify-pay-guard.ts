// Verifica el guardián del cobro: que nunca se cobre con la wallet en un
// estado que no se pudo confirmar, que un cambio de cuenta corte el flujo, y
// que con un txHash ya emitido JAMÁS se pida un segundo pago.
//
// Correr: node scripts/verify-pay-guard.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos. Estos casos
// son justo los que no se prueban a mano —requieren bloquear una extensión en
// el instante correcto—, así que viven aquí.
import {
  confirmBeforeSigning,
  decidePlayStart,
  reconcilePayer,
  type PendingPlay,
  type WalletProbe,
} from "../lib/pay-guard.ts";

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

const ME = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const OTRA = "0xfd43f6003484579ca068313736632eea8c651477";

const answered = (...accounts: string[]): WalletProbe => ({
  status: "answered",
  accounts,
});
const unreachable = (reason: string): WalletProbe => ({
  status: "unreachable",
  reason,
});

const pendiente: PendingPlay = {
  txHash: "0x" + "ab".repeat(32),
  player: ME,
  deckSize: 10,
};

console.log("\n— Wallet bloqueada o sin autorización —");

check(
  "extensión bloqueada (no expone cuentas) → reconectar",
  decidePlayStart({ expected: ME, probe: answered(), pending: null }),
  { kind: "reconnect", reason: "locked" }
);

check(
  "el proveedor lanza error → reconectar, NO se asume que está bien",
  decidePlayStart({
    expected: ME,
    probe: unreachable("provider threw"),
    pending: null,
  }),
  { kind: "reconnect", reason: "unreachable" }
);

check(
  "sin conector que preguntar → reconectar (falla cerrado)",
  decidePlayStart({
    expected: ME,
    probe: unreachable("no connector"),
    pending: null,
  }),
  { kind: "reconnect", reason: "unreachable" }
);

check(
  "revocó el permiso a la app: contesta con lista vacía → reconectar",
  decidePlayStart({ expected: ME, probe: answered(), pending: null }),
  { kind: "reconnect", reason: "locked" }
);

console.log("\n— Cambio de cuenta —");

check(
  "cambió de cuenta antes de pagar → cortar y revalidar identidad",
  decidePlayStart({ expected: ME, probe: answered(OTRA), pending: null }),
  { kind: "account_changed", expected: ME, actual: OTRA }
);

check(
  "la cuenta esperada sigue autorizada aunque no sea la primera → sigue con ELLA",
  decidePlayStart({ expected: ME, probe: answered(OTRA, ME), pending: null }),
  { kind: "proceed", address: ME }
);

check(
  "mayúsculas y minúsculas no son un cambio de cuenta",
  decidePlayStart({
    expected: ME.toUpperCase(),
    probe: answered(ME),
    pending: null,
  }),
  { kind: "proceed", address: ME }
);

check(
  "primera conexión (sin dirección previa) → toma la que expone la wallet",
  decidePlayStart({ expected: "", probe: answered(ME), pending: null }),
  { kind: "proceed", address: ME }
);

console.log("\n— Segunda comprobación, pegada a la firma —");

check(
  "sigue la misma cuenta → firmar",
  confirmBeforeSigning(ME, answered(ME)),
  { ok: true }
);

check(
  "cambió entre validar y firmar → NO se firma",
  confirmBeforeSigning(ME, answered(OTRA)),
  { ok: false, decision: { kind: "account_changed", expected: ME, actual: OTRA } }
);

check(
  "se bloqueó entre validar y firmar → NO se firma",
  confirmBeforeSigning(ME, answered()),
  { ok: false, decision: { kind: "reconnect", reason: "locked" } }
);

check(
  "dejó de responder entre validar y firmar → NO se firma",
  confirmBeforeSigning(ME, unreachable("timeout")),
  { ok: false, decision: { kind: "reconnect", reason: "unreachable" } }
);

console.log("\n— Jamás un segundo cobro con txHash pendiente —");

check(
  "jugada pagada sin registrar → terminar esa, no cobrar otra",
  decidePlayStart({ expected: ME, probe: answered(ME), pending: pendiente }),
  { kind: "resume_pending", pending: pendiente }
);

check(
  "…aunque la wallet esté bloqueada (no es motivo para volver a cobrar)",
  decidePlayStart({ expected: ME, probe: answered(), pending: pendiente }),
  { kind: "resume_pending", pending: pendiente }
);

check(
  "…aunque la wallet no responda",
  decidePlayStart({
    expected: ME,
    probe: unreachable("provider threw"),
    pending: pendiente,
  }),
  { kind: "resume_pending", pending: pendiente }
);

check(
  "…aunque haya cambiado de cuenta: el pago anterior sigue siendo suyo",
  decidePlayStart({ expected: OTRA, probe: answered(OTRA), pending: pendiente }),
  { kind: "resume_pending", pending: pendiente }
);

console.log("\n— Pagador on-chain distinto al esperado —");

check(
  "coincide → se registra a su nombre",
  reconcilePayer({ claimed: ME, onchain: ME }),
  { kind: "match", payer: ME }
);

check(
  "la cadena dice otra dirección → ni se pierde el pago ni se atribuye solo",
  reconcilePayer({ claimed: ME, onchain: OTRA }),
  { kind: "mismatch", payer: OTRA, claimed: ME }
);

check(
  "la verdad es la cadena, no lo que afirmó el cliente",
  reconcilePayer({ claimed: OTRA, onchain: ME }).payer,
  ME
);

console.log(
  failed === 0
    ? "\nTodo bien.\n"
    : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
