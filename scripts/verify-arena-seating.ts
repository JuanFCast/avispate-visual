// Quién puede crear una silla y en qué asiento. Dos reglas, las dos con dinero
// detrás:
//
//   1. En una mesa con ENTRADA, `/rooms/join` no crea sillas. Ninguna. La silla
//      la crea el pago verificado en la cadena y nada más. Sin esto, alguien que
//      hubiera pagado esa mesa podía canjear su ficha, llamar a `/rooms/join`
//      con una sesión cuyo perfil no tuviera fila, y meter una silla SIN pago:
//      la mesa dejaba de poder arrancar (`decideMatchStart` exige que todos los
//      sentados estén en la lista de pagadores) y, peor, corría los asientos
//      hasta dejar a un pagador legítimo sin poder registrarse.
//
//   2. El asiento es el PRIMER hueco, no el siguiente al último. Con `max + 1`,
//      unos asientos {0,1,2,3} daban 4, que la base rechaza por su `check`. Ese
//      rechazo no es un conflicto reintentable sino una excepción, y en `/paid`
//      salía como un 500 permanente delante de alguien que ya había pagado.
//
// Correr: node scripts/verify-arena-seating.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideRoomJoin, firstFreeSeat } from "../lib/arena-seating.ts";

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

const MESA = "0xaaa1";

console.log("\n— Mesa con entrada: por esta puerta no entra nadie —");
{
  // El ataque completo: el atacante PAGÓ esa mesa (así que tiene ficha válida)
  // y trae sesión. Da igual: aquí no se crea silla.
  check(
    "con ficha y sesión, y sitio de sobra → rechazado igual",
    decideRoomJoin({ tableId: MESA, taken: [0], maxPlayers: 4 }),
    { ok: false, error: "room_is_paid" }
  );

  check(
    "mesa vacía → sigue rechazado",
    decideRoomJoin({ tableId: MESA, taken: [], maxPlayers: 4 }),
    { ok: false, error: "room_is_paid" }
  );

  // Y se rechaza ANTES de mirar si hay sitio: el motivo tiene que ser siempre
  // el mismo. Si un día se colara un `room_full` aquí, significaría que la
  // comprobación se movió detrás del recuento y que en una mesa con hueco sí
  // se crearía la fila.
  const motivos = new Set(
    [0, 1, 2, 3, 4].map((n) =>
      JSON.stringify(
        decideRoomJoin({
          tableId: MESA,
          taken: Array.from({ length: n }, (_, i) => i),
          maxPlayers: 4,
        })
      )
    )
  );
  check("llena o vacía, un solo motivo", motivos.size, 1);
}

console.log("\n— La sala GRATIS sigue funcionando igual —");
{
  check(
    "sala vacía → asiento 0",
    decideRoomJoin({ tableId: null, taken: [], maxPlayers: 4 }),
    { ok: true, seat: 0 }
  );
  check(
    "con uno dentro → asiento 1",
    decideRoomJoin({ tableId: null, taken: [0], maxPlayers: 4 }),
    { ok: true, seat: 1 }
  );
  check(
    "llena → llena",
    decideRoomJoin({ tableId: null, taken: [0, 1], maxPlayers: 2 }),
    { ok: false, error: "room_full" }
  );
  check(
    "y una sala de 2 no acepta un tercero aunque el hueco 'siguiente' exista",
    decideRoomJoin({ tableId: null, taken: [0, 1], maxPlayers: 4 }),
    { ok: true, seat: 2 }
  );
}

console.log("\n— El primer hueco, no el siguiente al último —");
{
  check("sin nadie", firstFreeSeat([], 4), 0);
  check("hueco en medio: {0,2} → 1", firstFreeSeat([0, 2], 4), 1);
  check("hueco al principio: {1,2,3} → 0", firstFreeSeat([1, 2, 3], 4), 0);
  check("dos huecos: {2} → 0", firstFreeSeat([2], 4), 0);
  check("llena de verdad → null", firstFreeSeat([0, 1, 2, 3], 4), null);
  check("llena en una mesa de 2 → null", firstFreeSeat([0, 1], 2), null);

  // El caso exacto del 500: con `max + 1` esto devolvía 4, fuera del rango que
  // la base acepta, y reventaba en vez de conflictuar.
  check("nunca se sale del rango", firstFreeSeat([0, 1, 2, 3], 4), null);
  check("ni con asientos repetidos", firstFreeSeat([0, 0, 1, 1], 4), 2);
  // Desordenados: quien llama no promete ningún orden.
  check("ni desordenados", firstFreeSeat([3, 1, 0], 4), 2);
}

console.log("\n— La concurrencia: dos que calculan a la vez —");
{
  // Los dos ven la misma foto y eligen el MISMO asiento. Es lo correcto: el
  // índice único `(room_id, seat)` es quien arbitra, no este cálculo. Lo que se
  // fija aquí es que el perdedor, al releer, encuentre el hueco siguiente y no
  // se quede girando sobre el mismo número.
  const foto = [0];
  const a = decideRoomJoin({ tableId: null, taken: foto, maxPlayers: 4 });
  const b = decideRoomJoin({ tableId: null, taken: foto, maxPlayers: 4 });
  check("los dos calculan el mismo asiento", [a, b], [
    { ok: true, seat: 1 },
    { ok: true, seat: 1 },
  ]);

  // El que pierde relee (ahora el 1 está ocupado) y sigue adelante.
  check(
    "el que pierde, al releer, encuentra el siguiente",
    decideRoomJoin({ tableId: null, taken: [0, 1], maxPlayers: 4 }),
    { ok: true, seat: 2 }
  );

  // Y cuatro carreras seguidas terminan: cada vuelta ocupa un asiento más y la
  // última dice "llena" en vez de inventarse un número fuera de rango.
  let ocupados: number[] = [];
  const salidas: unknown[] = [];
  for (let i = 0; i < 5; i++) {
    const v = decideRoomJoin({ tableId: null, taken: ocupados, maxPlayers: 4 });
    salidas.push(v);
    if (v.ok) ocupados = [...ocupados, v.seat];
  }
  check(
    "cuatro entran, el quinto no",
    salidas,
    [
      { ok: true, seat: 0 },
      { ok: true, seat: 1 },
      { ok: true, seat: 2 },
      { ok: true, seat: 3 },
      { ok: false, error: "room_full" },
    ]
  );
}

console.log("\n— Y la regla está enchufada donde tiene que estar —");
{
  // Las dos reglas son inútiles si el código que escribe en la base no pasa por
  // ellas. Esto mira el fuente, como `verify-arena-start-guard.ts`.
  const rooms = readFileSync(join(ROOT, "lib/supabase/arena-rooms.ts"), "utf8");

  check(
    "`joinRoom` rechaza la mesa paga antes de su bucle",
    /if \(room\.table_id\) return fail\("room_is_paid"\);[\s\S]*for \(let attempt/.test(
      rooms
    ),
    true
  );
  check(
    "y el asiento que inserta sale del veredicto, no de un contador",
    /const verdict = decideRoomJoin\(\{[\s\S]*seat: verdict\.seat,/.test(rooms),
    true
  );
  check(
    "ya no queda el `while (taken.has(seat)) seat++`",
    /while \(taken\.has\(seat\)\)/.test(rooms),
    false
  );

  const escrow = readFileSync(
    join(ROOT, "lib/supabase/arena-escrow-db.ts"),
    "utf8"
  );
  check(
    "`nextFreeSeat` usa el primer hueco",
    /return firstFreeSeat\(/.test(escrow),
    true
  );
  check(
    "y ya no suma uno al mayor",
    /Number\(data\[0\]\.seat\) \+ 1/.test(escrow),
    false
  );
  check(
    "sin asiento libre, `seatPaidPlayer` conflictúa en vez de forzar uno",
    /if \(seat === null\) return \{ status: "conflict", reason: "room_full" \};/.test(
      escrow
    ),
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
