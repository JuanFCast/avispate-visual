// Verifica la regla obligatoria del escrow de Arena: una sesión abierta con un
// txHash NUNCA autoriza acciones en una mesa con entrada, y la silla la da el
// contrato, no la base de datos.
//
// Correr: node scripts/verify-arena-seat.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  decideSeatAccess,
  isForfeitAction,
  type SeatAction,
} from "../lib/arena-seat.ts";
import type { AppIdentity } from "../lib/identity.ts";

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

const ALICE = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const BOB = "0xfd43f6003484579ca068313736632eea8c651477";
const CAROL = "0x1246294f454710670deccf9ec6545c4241d40202";

/** Sesión de Privy: correo o firma SIWE. Sirve para mesas con dinero. */
const privy = (wallet: string): AppIdentity => ({
  privyId: "did:privy:cms9t2e75090f0bjsvaqrv89c",
  walletAddress: wallet,
});

/** Sesión de MiniPay: canjeada por el hash de una jugada. No sirve. */
const porTxHash = (wallet: string): AppIdentity => ({
  privyId: null,
  walletAddress: wallet,
});

const mesa = (o: {
  escrowed?: boolean;
  identity: AppIdentity;
  players?: readonly string[];
  action?: SeatAction;
}) =>
  decideSeatAccess({
    escrowed: o.escrowed ?? true,
    identity: o.identity,
    onchainPlayers: o.players ?? [ALICE, BOB],
    action: o.action ?? "act",
  });

console.log("\n— Mesas GRATIS: nada cambia —");

check(
  "sesión de MiniPay en mesa gratis → puede jugar como siempre",
  mesa({ escrowed: false, identity: porTxHash(CAROL) }),
  { ok: true }
);

check(
  "sin wallet en mesa gratis → sigue pudiendo",
  mesa({ escrowed: false, identity: { privyId: "did:privy:x", walletAddress: null } }),
  { ok: true }
);

console.log("\n— La regla: sesión por txHash NO autoriza dinero —");

check(
  "sesión de MiniPay en mesa con entrada → RECHAZADA, aunque haya pagado",
  mesa({ identity: porTxHash(ALICE) }),
  { ok: false, error: "session_not_allowed_on_paid_table" }
);

check(
  "…también para sentarse, no solo para jugar",
  mesa({ identity: porTxHash(ALICE), action: "join" }),
  { ok: false, error: "session_not_allowed_on_paid_table" }
);

check(
  "sesión de Privy de un pagador → adelante",
  mesa({ identity: privy(ALICE) }),
  { ok: true }
);

console.log("\n— La silla la da la cadena, no la base de datos —");

check(
  "sesión buena pero esa dirección no pagó → sin silla",
  mesa({ identity: privy(CAROL) }),
  { ok: false, error: "seat_not_paid" }
);

check(
  "sesión buena sin wallet asociada → no puede estar en una mesa pagada",
  mesa({ identity: { privyId: "did:privy:x", walletAddress: null } }),
  { ok: false, error: "wallet_required" }
);

check(
  "mayúsculas y minúsculas no cambian de quién es la silla",
  mesa({ identity: privy(ALICE.toUpperCase()), players: [ALICE, BOB] }),
  { ok: true }
);

check(
  "la lista viene de OTRA mesa → no la sienta aquí",
  mesa({ identity: privy(ALICE), players: [CAROL] }),
  { ok: false, error: "seat_not_paid" }
);

check(
  "mesa con escrow y todavía sin nadie pagando → nadie tiene silla",
  mesa({ identity: privy(ALICE), players: [] }),
  { ok: false, error: "seat_not_paid" }
);

console.log("\n— Levantarse no puede ser un botón en una mesa pagada —");

check("irse es una acción que regala dinero", isForfeitAction("leave"), true);
check("mover no", isForfeitAction("move"), false);
check("decir listo no", isForfeitAction("ready"), false);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
