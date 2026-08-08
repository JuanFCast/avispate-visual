// Verifica la confirmación de los jugadores en el lobby de una sala.
//
// Existe por un fallo real: el anfitrión aparecía "Sin confirmar" y no tenía
// ningún botón para confirmar, así que aunque el invitado estuviera Listo,
// "Iniciar partida" quedaba bloqueado para siempre. Mientras crear la sala te
// dejaba listo automáticamente no se notaba; al pasar el anfitrión a sentarse
// pagando como todos, quedó atrapado.
//
// Correr: node scripts/verify-arena-ready.ts
import {
  roomActionsFor,
  roomCanStart,
  roomIsFull,
  type RoomView,
} from "../lib/arena-rooms.ts";

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

const jugador = (o: {
  id: string;
  seat: number;
  host?: boolean;
  ready?: boolean;
}) => ({
  profileId: o.id,
  name: o.id,
  initial: o.id[0].toUpperCase(),
  seat: o.seat,
  isHost: Boolean(o.host),
  isReady: Boolean(o.ready),
  online: true,
  isYou: false,
});

/** La sala vista por `quien`. */
const sala = (
  jugadores: ReturnType<typeof jugador>[],
  quien: string
): RoomView => {
  const players = jugadores.map((p) => ({ ...p, isYou: p.profileId === quien }));
  return {
    code: "H7K2MP",
    status: "open",
    entryUnits: "1000000",
    maxPlayers: 2,
    cardsPerPlayer: 10,
    players,
    you: players.find((p) => p.isYou) ?? null,
    matchStarted: false,
    tableId: "0xaaa1",
  };
};

const ANF = "anfitrion";
const INV = "invitado";

console.log("\n— Mesa de 2: el recorrido completo —");

// 1. El anfitrión pagó y se sentó. Nadie más todavía.
let jugadores = [jugador({ id: ANF, seat: 0, host: true })];
check("solo el anfitrión: la mesa no está llena", roomIsFull(sala(jugadores, ANF)), false);
check("  y no se puede empezar", roomCanStart(sala(jugadores, ANF)), false);
check(
  "  pero YA puede confirmar que está listo",
  roomActionsFor(sala(jugadores, ANF)).canReady,
  true
);

// 2. Entra y paga el segundo.
jugadores = [
  jugador({ id: ANF, seat: 0, host: true }),
  jugador({ id: INV, seat: 1 }),
];
check("con los dos sentados, la mesa está llena", roomIsFull(sala(jugadores, ANF)), true);
check("  pero nadie ha confirmado: no se empieza", roomCanStart(sala(jugadores, ANF)), false);
check(
  "  pagar NO deja listo a nadie",
  jugadores.every((p) => !p.isReady),
  true
);

// 3. El invitado se pone listo. El anfitrión sigue sin confirmar.
jugadores = [
  jugador({ id: ANF, seat: 0, host: true }),
  jugador({ id: INV, seat: 1, ready: true }),
];
check(
  "invitado listo, anfitrión no → sigue sin poder empezar",
  roomCanStart(sala(jugadores, ANF)),
  false
);
check(
  "  ESTE era el fallo: el anfitrión tiene botón para confirmar",
  roomActionsFor(sala(jugadores, ANF)).canReady,
  true
);
check(
  "  y todavía no puede repartir",
  roomActionsFor(sala(jugadores, ANF)).canStart,
  false
);
check(
  "  el invitado tampoco puede repartir, por listo que esté",
  roomActionsFor(sala(jugadores, INV)).canStart,
  false
);

// 4. El anfitrión pulsa "Estoy listo".
jugadores = [
  jugador({ id: ANF, seat: 0, host: true, ready: true }),
  jugador({ id: INV, seat: 1, ready: true }),
];
check("todos listos → se puede empezar", roomCanStart(sala(jugadores, ANF)), true);
check(
  "  y repartir es SOLO del anfitrión",
  roomActionsFor(sala(jugadores, ANF)).canStart,
  true
);
check(
  "  el invitado ve que espera al anfitrión",
  roomActionsFor(sala(jugadores, INV)),
  { canReady: true, canStart: false, waitingForHost: true }
);

console.log("\n— Casos que no deben colarse —");

check(
  "el anfitrión solo, aunque esté listo, no reparte",
  roomActionsFor(sala([jugador({ id: ANF, seat: 0, host: true, ready: true })], ANF)).canStart,
  false
);

check(
  "quien mira sin estar sentado no tiene ninguna acción",
  roomActionsFor({ ...sala(jugadores, "otro"), you: null }),
  { canReady: false, canStart: false, waitingForHost: false }
);

{
  const cerrada = { ...sala(jugadores, ANF), status: "closed" as const };
  check("en una sala cerrada no se confirma", roomActionsFor(cerrada).canReady, false);
  check("  ni se reparte", roomActionsFor(cerrada).canStart, false);
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
