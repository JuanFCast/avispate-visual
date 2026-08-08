// Verifica la confirmación de los jugadores en el lobby de una sala.
//
// Existe por un fallo real: el anfitrión aparecía "Sin confirmar" y no tenía
// ningún botón para confirmar, así que aunque el invitado estuviera Listo,
// "Iniciar partida" quedaba bloqueado para siempre. Mientras crear la sala te
// dejaba listo automáticamente no se notaba; al pasar el anfitrión a sentarse
// pagando como todos, quedó atrapado.
//
// Y por un segundo, de forma: al arreglarlo, el botón de confirmar quedó como
// conmutador, así que después de decir "Estoy listo" aparecía un "Ya no estoy
// listo" del mismo tamaño justo al lado de "Iniciar partida". Dos CTA
// compitiendo, y el que gana por posición es el de deshacer. Por eso ahora
// confirmar y deshacer son dos permisos distintos y no un interruptor.
//
// Correr: node scripts/verify-arena-ready.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  roomActionsFor,
  roomCanStart,
  roomIsFull,
  startHintFor,
  startHintMessage,
  type RoomView,
} from "../lib/arena-rooms.ts";

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
  quien: string,
  maxPlayers = 2
): RoomView => {
  const players = jugadores.map((p) => ({ ...p, isYou: p.profileId === quien }));
  return {
    code: "H7K2MP",
    status: "open",
    entryUnits: "1000000",
    maxPlayers,
    cardsPerPlayer: 10,
    players,
    you: players.find((p) => p.isYou) ?? null,
    matchStarted: false,
    tableId: "0xaaa1",
  };
};

/** El texto que acabaría en pantalla, ya resuelto singular/plural. */
const aviso = (room: RoomView) =>
  startHintMessage(startHintFor(room), Boolean(room.you?.isHost));

const ANF = "anfitrion";
const INV = "invitado";

console.log("\n— Mesa de 2: el recorrido completo —");

// 1. El anfitrión pagó y se sentó. Nadie más todavía.
let jugadores = [jugador({ id: ANF, seat: 0, host: true })];
check("solo el anfitrión: la mesa no está llena", roomIsFull(sala(jugadores, ANF)), false);
check("  y no se puede empezar", roomCanStart(sala(jugadores, ANF)), false);
check(
  "  pero YA puede confirmar que está listo",
  roomActionsFor(sala(jugadores, ANF)).canConfirm,
  true
);
check(
  "  y el aviso dice a cuánta gente se espera, con cifra",
  aviso(sala(jugadores, ANF)),
  { key: "room.start.waiting_one" }
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
check(
  "  y el freno es SUYO, así que eso es lo que se le dice",
  aviso(sala(jugadores, ANF)),
  { key: "room.start.need_you" }
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
  roomActionsFor(sala(jugadores, ANF)).canConfirm,
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
  { canConfirm: false, canUndo: true, canStart: false, waitingForHost: true }
);
check(
  "  y se lo dice con palabras",
  aviso(sala(jugadores, INV)),
  { key: "room.guest.waiting_host" }
);
check(
  "  al anfitrión, en cambio, se le dice que ya puede",
  aviso(sala(jugadores, ANF)),
  { key: "room.start.ready" }
);

console.log("\n— Confirmado: el botón grande desaparece —");

{
  // El corazón del cambio de forma. Antes `canReady` seguía en true después de
  // confirmar y la pantalla pintaba el mismo botón con el texto invertido.
  const mesa = (listo: boolean) =>
    sala(
      [
        jugador({ id: ANF, seat: 0, host: true }),
        jugador({ id: INV, seat: 1, ready: listo }),
      ],
      INV
    );

  const antes = roomActionsFor(mesa(false));
  check("antes de confirmar hay botón de confirmar", antes.canConfirm, true);
  check("  y nada que deshacer todavía", antes.canUndo, false);

  const despues = roomActionsFor(mesa(true));
  check("después de confirmar, el botón YA NO está", despues.canConfirm, false);
  check("  y en su lugar se puede deshacer", despues.canUndo, true);
  check(
    "  nunca las dos cosas a la vez, que es lo que hacía el conmutador",
    despues.canConfirm && despues.canUndo,
    false
  );
}

{
  // Y para el anfitrión listo, la única acción protagonista es repartir.
  const anfitrion = roomActionsFor(sala(jugadores, ANF));
  check(
    "el anfitrión listo: repartir sí, confirmar ya no",
    { canStart: anfitrion.canStart, canConfirm: anfitrion.canConfirm },
    { canStart: true, canConfirm: false }
  );
}

console.log("\n— El aviso cuenta lo que falta, en mesas de 3 y 4 —");

{
  const uno = sala([jugador({ id: ANF, seat: 0, host: true })], ANF, 4);
  check("faltan tres sillas", aviso(uno), {
    key: "room.start.waiting_many",
    vars: { n: 3 },
  });

  const dos = sala(
    [jugador({ id: ANF, seat: 0, host: true }), jugador({ id: INV, seat: 1 })],
    ANF,
    3
  );
  check("falta una sola: en singular", aviso(dos), { key: "room.start.waiting_one" });

  // Llena, el anfitrión ya confirmó, faltan los otros dos.
  const llena = sala(
    [
      jugador({ id: ANF, seat: 0, host: true, ready: true }),
      jugador({ id: "b", seat: 1 }),
      jugador({ id: "c", seat: 2 }),
    ],
    ANF,
    3
  );
  check("dos por confirmar", aviso(llena), {
    key: "room.start.need_confirm_many",
    vars: { n: 2 },
  });

  const casi = sala(
    [
      jugador({ id: ANF, seat: 0, host: true, ready: true }),
      jugador({ id: "b", seat: 1, ready: true }),
      jugador({ id: "c", seat: 2 }),
    ],
    ANF,
    3
  );
  check("uno por confirmar: en singular", aviso(casi), {
    key: "room.start.need_confirm_one",
  });
}

console.log("\n— Casos que no deben colarse —");

check(
  "el anfitrión solo, aunque esté listo, no reparte",
  roomActionsFor(sala([jugador({ id: ANF, seat: 0, host: true, ready: true })], ANF)).canStart,
  false
);

check(
  "quien mira sin estar sentado no tiene ninguna acción",
  roomActionsFor({ ...sala(jugadores, "otro"), you: null }),
  { canConfirm: false, canUndo: false, canStart: false, waitingForHost: false }
);

{
  const cerrada = { ...sala(jugadores, ANF), status: "closed" as const };
  check(
    "en una sala cerrada no se confirma",
    roomActionsFor(cerrada).canConfirm,
    false
  );
  check("  ni se deshace", roomActionsFor(cerrada).canUndo, false);
  check("  ni se reparte", roomActionsFor(cerrada).canStart, false);
}

console.log("\n— Y nada de esto toca la cadena —");

{
  // Confirmar es una columna en Supabase (`is_ready`) y nada más: sin firma,
  // sin gas y sin transacción. Se comprueba sobre la ruta que lo escribe, que
  // es donde se colaría si alguna vez dejara de ser cierto.
  const src = readFileSync(
    join(ROOT, "app/api/arena/rooms/[code]/ready/route.ts"),
    "utf8"
  );
  check(
    "la ruta de confirmar no firma, no paga y no llama a ningún contrato",
    /writeContract|sendTransaction|signMessage|personal_sign|from "viem"/.test(src),
    false
  );
  check("  escribe el estado y ya", /setReady/.test(src), true);
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
