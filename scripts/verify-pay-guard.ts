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

// ---------------------------------------------------------------------------
// La wallet DEL PERFIL: el filtro que faltaba, y el caso real que lo pidió.
// ---------------------------------------------------------------------------
//
// PipeRabby entró con su Rabby bloqueada. Privy lo dio por "usuario sin
// wallets" y le creó una embebida. Esa embebida contesta perfectamente, es
// estable entre comprobaciones y pasa los tres filtros anteriores sin
// despeinarse — y no es quien tiene el historial ni quien cobra el premio.
//
// Que la wallet conteste y sea la misma de hace un segundo no la convierte en
// la tuya. Eso es lo que se fija aquí.

const RABBY = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const EMBEBIDA = "0xfd43f6003484579ca068313736632eea8c651477";

console.log("\n— La wallet del perfil manda —");

check(
  "con la canónica conectada, vía libre",
  decidePlayStart({
    expected: RABBY,
    probe: { status: "answered", accounts: [RABBY] },
    pending: null,
    canonical: { status: "known", address: RABBY },
  }),
  { kind: "proceed", address: RABBY }
);

check(
  "PIPERABBY: la embebida accidental NO puede pagar",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: null,
    canonical: { status: "known", address: RABBY },
  }),
  { kind: "wrong_wallet", canonical: RABBY, connected: EMBEBIDA }
);

// El detalle que lo hacía invisible: para los filtros de antes, la embebida es
// una wallet impecable. Sin `canonical` habría pasado.
check(
  "y sin la canónica habría pasado — por eso hacía falta",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: null,
  }),
  { kind: "proceed", address: EMBEBIDA }
);

check(
  "aunque la wallet exponga las dos, solo firma la del perfil",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA, RABBY] },
    pending: null,
    canonical: { status: "known", address: RABBY },
  }),
  { kind: "wrong_wallet", canonical: RABBY, connected: EMBEBIDA }
);

console.log("\n— Rabby bloqueada o reconectando —");

check(
  "bloqueada: se reconecta, y NO se convierte en 'wallet equivocada'",
  decidePlayStart({
    expected: RABBY,
    probe: { status: "answered", accounts: [] },
    pending: null,
    canonical: { status: "known", address: RABBY },
  }),
  { kind: "reconnect", reason: "locked" }
);

check(
  "sin respuesta: tampoco se cobra",
  decidePlayStart({
    expected: RABBY,
    probe: { status: "unreachable", reason: "timeout" },
    pending: null,
    canonical: { status: "known", address: RABBY },
  }),
  { kind: "reconnect", reason: "unreachable" }
);

// El orden importa: una jugada ya pagada se termina ANTES de mirar de quién es
// la wallet. Nunca se cobra dos veces por arreglar una identidad.
check(
  "una jugada pendiente manda sobre todo lo demás",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: { txHash: "0xabc", player: EMBEBIDA, deckSize: 10 },
    canonical: { status: "known", address: RABBY },
  }).kind,
  "resume_pending"
);

console.log("\n— Cambio REAL de cuenta —");

check(
  "cambió de cuenta y encima no es la del perfil: gana 'cambió'",
  decidePlayStart({
    expected: RABBY,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: null,
    canonical: { status: "known", address: RABBY },
  }),
  { kind: "account_changed", expected: RABBY, actual: EMBEBIDA }
);

check(
  "jugador nuevo sin canónica: la que trae es la suya",
  decidePlayStart({
    expected: null,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: null,
    canonical: { status: "none" },
  }),
  { kind: "proceed", address: EMBEBIDA }
);

console.log("\n— Y pegado a la firma se vuelve a exigir —");

check(
  "la canónica firma",
  confirmBeforeSigning(RABBY, { status: "answered", accounts: [RABBY] }, { status: "known", address: RABBY }),
  { ok: true }
);

// Sin esto, entre la comprobación de arriba y la firma cabía un cambio a la
// embebida y el pago se habría hecho a nombre de otra identidad.
check(
  "la embebida NO firma, aunque conteste bien",
  confirmBeforeSigning(EMBEBIDA, { status: "answered", accounts: [EMBEBIDA] }, { status: "known", address: RABBY }),
  {
    ok: false,
    decision: { kind: "wrong_wallet", canonical: RABBY, connected: EMBEBIDA },
  }
);

check(
  "y sin canónica se comporta como siempre",
  confirmBeforeSigning(EMBEBIDA, { status: "answered", accounts: [EMBEBIDA] }),
  { ok: true }
);

console.log("\n— Ninguna ajena pasa, se mire como se mire —");
{
  // Cinco formas de traer la wallet equivocada. Ninguna cobra.
  const ajenas = [
    { status: "answered", accounts: [EMBEBIDA] } as const,
    { status: "answered", accounts: [OTRA] } as const,
    { status: "answered", accounts: [EMBEBIDA, OTRA] } as const,
    { status: "answered", accounts: [] } as const,
    { status: "unreachable", reason: "x" } as const,
  ];
  const pasaron = ajenas.filter(
    (probe) =>
      decidePlayStart({
        expected: EMBEBIDA,
        probe,
        pending: null,
        canonical: { status: "known", address: RABBY },
      }).kind === "proceed"
  );
  check("ninguna de las cinco cobra", pasaron.length, 0);
}

// ---------------------------------------------------------------------------
// "Todavia no lo se" NO es "no hay". El agujero que el barrido encontro.
// ---------------------------------------------------------------------------
//
// `canonical` era `string | null`, y ese null decia dos cosas incompatibles:
// "este jugador no tiene wallet anotada" y "el perfil aun no ha llegado". El
// guardian leia las dos como la primera, asi que MIENTRAS EL PERFIL CARGABA se
// apagaba solo y cualquier wallet conectada podia pagar — incluida la embebida
// accidental, que es justo contra lo que existe.

console.log("\n— El guardian no se apaga mientras carga el perfil —");

check(
  "PIPERABBY, perfil en vuelo: NO se cobra",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: null,
    canonical: { status: "loading" },
  }),
  { kind: "checking" }
);

// Ni siquiera con la wallet correcta: no saber no autoriza, en ningun sentido.
check(
  "ni con la canonica puesta, si aun no se sabe",
  decidePlayStart({
    expected: RABBY,
    probe: { status: "answered", accounts: [RABBY] },
    pending: null,
    canonical: { status: "loading" },
  }),
  { kind: "checking" }
);

check(
  "y pegado a la firma tampoco",
  confirmBeforeSigning(
    RABBY,
    { status: "answered", accounts: [RABBY] },
    { status: "loading" }
  ),
  { ok: false, decision: { kind: "checking" } }
);

// Un jugador nuevo de verdad SI juega: `none` no es `loading`.
check(
  "sin wallet anotada (jugador nuevo) si se puede",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: null,
    canonical: { status: "none" },
  }),
  { kind: "proceed", address: EMBEBIDA }
);

// Y el orden se respeta: una jugada ya pagada se termina aunque no se sepa de
// quien es la cuenta. Nunca se cobra dos veces por resolver una identidad.
check(
  "una jugada pendiente manda incluso sobre el 'no lo se'",
  decidePlayStart({
    expected: EMBEBIDA,
    probe: { status: "answered", accounts: [EMBEBIDA] },
    pending: { txHash: "0xabc", player: EMBEBIDA, deckSize: 10 },
    canonical: { status: "loading" },
  }).kind,
  "resume_pending"
);

// Y la wallet inaccesible sigue mandando sobre el "no lo se": son dos frenos y
// el mensaje correcto es el de reconectar, no el de esperar.
check(
  "wallet bloqueada gana al 'no lo se'",
  decidePlayStart({
    expected: RABBY,
    probe: { status: "answered", accounts: [] },
    pending: null,
    canonical: { status: "loading" },
  }),
  { kind: "reconnect", reason: "locked" }
);

console.log(
  failed === 0
    ? "\nTodo bien.\n"
    : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
