// Verifica quién puede CREAR una sala, y sobre todo que crearla no otorgue
// nada: el caso del usuario nuevo de MiniPay que monta su primera mesa sin
// haber jugado nunca, paga, y solo entonces queda sentado.
//
// Correr: node scripts/verify-arena-create.ts
import {
  decideRoomCreation,
  mayLeaveOtherRooms,
} from "../lib/arena-create.ts";
import { decideSeatAccess } from "../lib/arena-seat.ts";
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

const NUEVA = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const OTRA = "0xfd43f6003484579ca068313736632eea8c651477";
const MESA = "0xaaa1";

const conSesion: AppIdentity = {
  privyId: "did:privy:x",
  walletAddress: NUEVA,
};

console.log("\n— El usuario nuevo de MiniPay: sin sesión, sin haber jugado —");

check(
  "puede crear una mesa CON entrada, diciendo qué wallet trae",
  decideRoomCreation({
    identity: null,
    escrowed: true,
    claimedAddress: NUEVA,
  }),
  { kind: "unverified", address: NUEVA }
);

check(
  "la dirección se normaliza",
  decideRoomCreation({
    identity: null,
    escrowed: true,
    claimedAddress: NUEVA.toUpperCase(),
  }),
  { kind: "unverified", address: NUEVA }
);

check(
  "sin dirección válida, no",
  decideRoomCreation({ identity: null, escrowed: true, claimedAddress: "hola" }),
  { kind: "denied", error: "invalid_address" }
);

check(
  "sin dirección ninguna, no",
  decideRoomCreation({ identity: null, escrowed: true }),
  { kind: "denied", error: "invalid_address" }
);

console.log("\n— Y crear NO le da absolutamente nada —");

// Esto es el corazón del asunto: acaba de crear la mesa y todavía no ha pagado.
const reciénCreada = {
  escrowed: true,
  tableId: MESA,
  seat: null,
  onchainPlayers: [] as string[],
  action: "act" as const,
};

check(
  "no puede jugar",
  decideSeatAccess(reciénCreada),
  { ok: false, error: "seat_token_required" }
);
check(
  "no puede marcar listo ni empezar (misma puerta)",
  decideSeatAccess({ ...reciénCreada, action: "act" }),
  { ok: false, error: "seat_token_required" }
);
check(
  "no puede sentarse por el hecho de haberla creado",
  decideSeatAccess({ ...reciénCreada, action: "join" }),
  { ok: false, error: "seat_token_required" }
);

console.log("\n— Después de pagar y canjear su ficha, sí —");

check(
  "con ficha y pago on-chain, dentro",
  decideSeatAccess({
    escrowed: true,
    tableId: MESA,
    seat: { tableId: MESA, address: NUEVA },
    onchainPlayers: [NUEVA],
    action: "act",
  }),
  { ok: true }
);

check(
  "pero una ficha sin pago on-chain sigue sin valer",
  decideSeatAccess({
    escrowed: true,
    tableId: MESA,
    seat: { tableId: MESA, address: NUEVA },
    onchainPlayers: [OTRA],
    action: "act",
  }),
  { ok: false, error: "seat_not_paid" }
);

console.log("\n— El navegador normal NO se relaja —");

check(
  "con sesión, el camino de siempre",
  decideRoomCreation({ identity: conSesion, escrowed: true }),
  { kind: "session" }
);

check(
  "una sala GRATIS sin sesión → rechazada",
  decideRoomCreation({ identity: null, escrowed: false, claimedAddress: NUEVA }),
  { kind: "denied", error: "unauthorized" }
);

check(
  "una sala gratis con sesión → normal",
  decideRoomCreation({ identity: conSesion, escrowed: false }),
  { kind: "session" }
);

console.log("\n— Nadie puede echar a otro de su mesa creando una sala —");

check(
  "con sesión probada, sí se sale de las otras salas",
  mayLeaveOtherRooms({ kind: "session" }),
  true
);
check(
  "con una dirección sin probar, NO",
  mayLeaveOtherRooms({ kind: "unverified", address: NUEVA }),
  false
);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
