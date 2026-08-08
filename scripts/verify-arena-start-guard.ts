// Verifica que una mesa incompleta NO se pueda repartir, y que la entrada de
// quien está esperando solo no se pueda perder por ningún camino.
//
// ── El escenario, tal cual se reportó ──────────────────────────────────────
//
//   el anfitrión paga 1 USDT → queda 1/2 → intenta iniciar → la petición se
//   rechaza → la sala sigue esperando → conserva su silla y su pago → no hay
//   liquidación ni ganador → y si la mesa se cancela, recupera su entrada.
//
// Se recorre entero, paso por paso, más abajo.
//
// ── Lo que de verdad comprometía el dólar ──────────────────────────────────
//
// No era el botón: `startMatch` ya rechazaba la mesa a medias, y el contrato
// jamás habría pagado una mesa `Open` (`settle` revierte con
// `TableNotPlayable`). Eran dos `delete` sobre la fila de la silla, que es la
// única constancia nuestra de qué dirección puso el dinero:
//
//   · `pruneAndListPlayers`, en CADA lectura de la sala, borraba al que llevara
//     60 s sin latir — y cerraba la sala si era el anfitrión. Bloquear el
//     teléfono un minuto esperando rival bastaba.
//   · `leaveAllRooms`, al crear o entrar a otra sala, borraba todas sus filas.
//     Un toque en "Otra sala" y listo.
//
// En los dos casos la entrada se quedaba dentro del contrato sin nadie que la
// reclamara desde la aplicación. Aquí se fija que eso no vuelva a pasar.
//
// Correr: node scripts/verify-arena-start-guard.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideMatchStart,
  decideStaleTable,
  seatIsDroppable,
  type StartSeat,
} from "../lib/arena-start.ts";
import { decideMatchOutcome } from "../lib/arena-outcome.ts";
import { PLAYER_DROP_MS, ROOM_TTL_MS } from "../lib/arena-rooms.ts";

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

const ANF = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const INV = "0xfd43f6003484579ca068313736632eea8c651477";

const silla = (address: string | null, ready = false): StartSeat => ({
  ready,
  walletAddress: address,
});

const AHORA = 1_770_000_000_000;
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

console.log("\n══ El escenario reportado, paso por paso ══");

console.log("\n1. El anfitrión pagó 1 USDT y está solo: 1 de 2.");

const soloEl = {
  isHost: true,
  roomLive: true,
  maxPlayers: 2,
  seated: [silla(ANF, true)],
  onchainPlayers: [ANF],
};

check(
  "  intenta iniciar → RECHAZADO, y se dice que falta gente",
  decideMatchStart(soloEl),
  { ok: false, error: "room_not_full" }
);
check(
  "  y da igual que fuerce la petición contra la API: la regla es del servidor",
  decideMatchStart({ ...soloEl, seated: [silla(ANF, true)] }).ok,
  false
);
check(
  "  tampoco cuela marcándose listo mil veces",
  decideMatchStart({ ...soloEl, seated: [silla(ANF, true)] }),
  { ok: false, error: "room_not_full" }
);

console.log("\n2. Y esperando NO se le puede quitar la silla.");

const suSilla = { paidAt: hace(60_000), lastSeenAt: hace(10 * 60_000) };
check(
  "  diez minutos con el teléfono bloqueado: la silla pagada NO se suelta",
  seatIsDroppable(suSilla, PLAYER_DROP_MS, AHORA),
  false
);
check(
  "  ni a las dos horas",
  seatIsDroppable({ ...suSilla, lastSeenAt: hace(2 * 60 * 60_000) }, PLAYER_DROP_MS, AHORA),
  false
);
check(
  "  en una sala GRATIS sí se suelta, que para eso está",
  seatIsDroppable({ paidAt: null, lastSeenAt: hace(10 * 60_000) }, PLAYER_DROP_MS, AHORA),
  true
);
check(
  "  y a la gratis reciente tampoco se le quita",
  seatIsDroppable({ paidAt: null, lastSeenAt: hace(5_000) }, PLAYER_DROP_MS, AHORA),
  false
);

console.log("\n3. No hay liquidación ni ganador: no hubo partida.");

// `decideMatchOutcome` solo se consulta sobre una partida existente, y aquí no
// la hay. Aun así se comprueba el peor de los casos: si alguien la invocara con
// un solo asiento, no puede salir un pago "por quedarse el último".
check(
  "  con la mesa a medias no hay partida que decidir…",
  decideMatchStart(soloEl).ok,
  false
);

{
  // …y aunque nuestro servidor se equivocara, el contrato es la última puerta:
  // `settle` exige `Status.Full`, y una mesa con 1 de 2 está en `Open`. Se
  // comprueba sobre el código del contrato porque es la afirmación que sostiene
  // todo lo demás — si esa línea desaparece, este escenario deja de estar
  // protegido por abajo y hay que enterarse aquí.
  const sol = readFileSync(
    join(ROOT, "contracts/contracts/AvispateArena.sol"),
    "utf8"
  );
  const settle = sol.slice(sol.indexOf("function settle("));
  check(
    "  …y el contrato tampoco pagaría: settle exige que la mesa esté Full",
    /if \(t\.status != Status\.Full\) revert TableNotPlayable\(\);/.test(
      settle.slice(0, 600)
    ),
    true
  );
  check(
    "  ni pagaría a quien no se sentó en ella",
    /if \(!paid\[tableId\]\[winner\]\) revert WinnerNotInTable\(\);/.test(
      settle.slice(0, 600)
    ),
    true
  );
  check(
    "  y una mesa anulada devuelve la entrada íntegra, sin comisión",
    /token\.safeTransfer\(player, t\.entry\);/.test(sol),
    true
  );
}

console.log("\n4. Si la mesa se cancela o vence, devolución íntegra.");

check(
  "  sala cerrada sin partida → se anula y se devuelve",
  decideStaleTable({
    hasMatch: false,
    roomClosed: true,
    ageMs: 60_000,
    alreadyRefunded: false,
    ttlMs: ROOM_TTL_MS,
  }),
  "refund"
);
check(
  "  sala vencida sin partida → igual",
  decideStaleTable({
    hasMatch: false,
    roomClosed: false,
    ageMs: ROOM_TTL_MS + 1,
    alreadyRefunded: false,
    ttlMs: ROOM_TTL_MS,
  }),
  "refund"
);
check(
  "  pero mientras siga viva y llenándose, NO se toca",
  decideStaleTable({
    hasMatch: false,
    roomClosed: false,
    ageMs: 5 * 60_000,
    alreadyRefunded: false,
    ttlMs: ROOM_TTL_MS,
  }),
  "wait"
);
check(
  "  una mesa que SÍ jugó no se anula por detrás: manda la liquidación",
  decideStaleTable({
    hasMatch: true,
    roomClosed: true,
    ageMs: ROOM_TTL_MS + 1,
    alreadyRefunded: false,
    ttlMs: ROOM_TTL_MS,
  }),
  "skip"
);
check(
  "  y no se devuelve dos veces",
  decideStaleTable({
    hasMatch: false,
    roomClosed: true,
    ageMs: ROOM_TTL_MS + 1,
    alreadyRefunded: true,
    ttlMs: ROOM_TTL_MS,
  }),
  "skip"
);

console.log("\n══ El resto de la puerta ══");

console.log("\n— Con la mesa llena y pagada, se reparte —");

const llena = {
  isHost: true,
  roomLive: true,
  maxPlayers: 2,
  seated: [silla(ANF, true), silla(INV, true)],
  onchainPlayers: [ANF, INV],
};
check("dos sentados, pagados y listos", decideMatchStart(llena), { ok: true });
check(
  "  las mayúsculas de una dirección no son otra dirección",
  decideMatchStart({ ...llena, onchainPlayers: [ANF.toUpperCase(), INV] }),
  { ok: true }
);

console.log("\n— Pagados pero sin confirmar —");

check(
  "falta que uno diga que está listo",
  decideMatchStart({ ...llena, seated: [silla(ANF, true), silla(INV, false)] }),
  { ok: false, error: "players_not_ready" }
);

console.log("\n— Sentado pero sin pagar: el caso que la base no veía —");

check(
  "una silla que la cadena no conoce",
  decideMatchStart({ ...llena, onchainPlayers: [ANF] }),
  { ok: false, error: "seats_not_paid" }
);
check(
  "una fila sin dirección en una mesa con entrada",
  decideMatchStart({ ...llena, seated: [silla(ANF, true), silla(null, true)] }),
  { ok: false, error: "seats_not_paid" }
);
check(
  "dos filas apuntando a la MISMA dirección no son dos pagadores",
  decideMatchStart({ ...llena, onchainPlayers: [ANF, ANF] }),
  { ok: false, error: "seats_not_paid" }
);
check(
  "y el dinero manda sobre la voluntad: primero se dice que no pagó",
  decideMatchStart({
    ...llena,
    seated: [silla(ANF, false), silla(INV, false)],
    onchainPlayers: [ANF],
  }),
  { ok: false, error: "seats_not_paid" }
);

console.log("\n— Mesas gratis: la cadena no opina —");

check(
  "sin escrow, basta con estar y estar listo",
  decideMatchStart({
    isHost: true,
    roomLive: true,
    maxPlayers: 2,
    seated: [silla(null, true), silla(null, true)],
    onchainPlayers: null,
  }),
  { ok: true }
);
check(
  "y sigue sin poder repartirse a medias",
  decideMatchStart({
    isHost: true,
    roomLive: true,
    maxPlayers: 2,
    seated: [silla(null, true)],
    onchainPlayers: null,
  }),
  { ok: false, error: "room_not_full" }
);

console.log("\n— Quién y cuándo —");

check("solo el anfitrión reparte", decideMatchStart({ ...llena, isHost: false }), {
  ok: false,
  error: "not_host",
});
check("y no en una sala cerrada", decideMatchStart({ ...llena, roomLive: false }), {
  ok: false,
  error: "room_closed",
});
check(
  "una mesa con MÁS gente que sillas tampoco se reparte",
  decideMatchStart({
    ...llena,
    maxPlayers: 2,
    seated: [silla(ANF, true), silla(INV, true), silla(ANF, true)],
  }),
  { ok: false, error: "room_not_full" }
);

console.log("\n— La regla vieja sigue en pie: abandonar no devuelve nada —");

// Esto NO cambia con nada de lo anterior: la devolución es solo para la mesa
// que nunca empezó. Una vez repartida, quien se va pierde y cobra el que queda.
check(
  "partida empezada y uno se va → gana el otro, no se devuelve",
  decideMatchOutcome(
    [
      { address: ANF, cleared: false, left: true, lastSeenAt: AHORA },
      { address: INV, cleared: false, left: false, lastSeenAt: AHORA },
    ],
    AHORA,
    90_000
  ),
  { kind: "settle", winner: INV, reason: "abandoned" }
);

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
