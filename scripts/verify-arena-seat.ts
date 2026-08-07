// Verifica el acceso a una silla de la Arena: que en una mesa con entrada haga
// falta la FICHA de esa silla —no una sesión, sea del tipo que sea—, que la
// ficha no sirva en otra mesa, y que además la cadena confirme el pago.
//
// Correr: node scripts/verify-arena-seat.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  decideSeatAccess,
  isForfeitAction,
  type SeatAction,
} from "../lib/arena-seat.ts";

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

const MESA = "0xaaa1";
const OTRA_MESA = "0xbbb2";

/** Lo que devuelve `verifySeatToken` cuando la firma cuadra. */
const ficha = (address: string, tableId = MESA) => ({ tableId, address });

const mesa = (o: {
  escrowed?: boolean;
  seat?: { tableId: string; address: string } | null;
  players?: readonly string[];
  action?: SeatAction;
}) =>
  decideSeatAccess({
    escrowed: o.escrowed ?? true,
    tableId: MESA,
    seat: o.seat ?? null,
    onchainPlayers: o.players ?? [ALICE, BOB],
    action: o.action ?? "act",
  });

console.log("\n— Mesas GRATIS: nada cambia —");

check("sin ficha en mesa gratis → adelante", mesa({ escrowed: false }), {
  ok: true,
});

console.log("\n— En una mesa con entrada, la sesión no basta —");

check(
  "sin ficha de silla → rechazado, da igual qué sesión traiga",
  mesa({ seat: null }),
  { ok: false, error: "seat_token_required" }
);

check(
  "…también para sentarse",
  mesa({ seat: null, action: "join" }),
  { ok: false, error: "seat_token_required" }
);

check(
  "con la ficha de su silla → adelante (esto es lo que devuelve MiniPay al juego)",
  mesa({ seat: ficha(ALICE) }),
  { ok: true }
);

console.log("\n— La ficha vale solo para SU mesa —");

check(
  "ficha de otra mesa → rechazada aunque el jugador haya pagado aquí",
  mesa({ seat: ficha(ALICE, OTRA_MESA) }),
  { ok: false, error: "seat_token_wrong_table" }
);

check(
  "mayúsculas y minúsculas no cambian de mesa",
  mesa({ seat: ficha(ALICE, MESA.toUpperCase()) }),
  { ok: true }
);

console.log("\n— Y la cadena tiene que confirmar el pago —");

check(
  "ficha válida de quien NO pagó esta mesa → sin silla",
  mesa({ seat: ficha(CAROL) }),
  { ok: false, error: "seat_not_paid" }
);

check(
  "la lista de pagadores viene de otra mesa → sin silla",
  mesa({ seat: ficha(ALICE), players: [CAROL] }),
  { ok: false, error: "seat_not_paid" }
);

check(
  "mesa anulada o devuelta (lista vacía) → la ficha ya no sirve sola",
  mesa({ seat: ficha(ALICE), players: [] }),
  { ok: false, error: "seat_not_paid" }
);

check(
  "la dirección de la ficha no distingue mayúsculas",
  mesa({ seat: ficha(ALICE.toUpperCase()) }),
  { ok: true }
);

console.log("\n— Levantarse no puede ser un botón en una mesa pagada —");

check("irse es una acción que regala dinero", isForfeitAction("leave"), true);
check("mover no", isForfeitAction("move"), false);
check("decir listo no", isForfeitAction("ready"), false);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
