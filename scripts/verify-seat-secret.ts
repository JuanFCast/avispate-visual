// Verifica el secreto de la silla: que se GUARDE antes de que exista la huella
// con la que se paga, que no se pueda pagar si no se pudo guardar, y que la
// huella no revele el secreto.
//
// Correr: node scripts/verify-seat-secret.ts
//
// La tienda se inyecta, así que esto corre sin navegador — que es justo lo que
// permite probar el caso feo: el almacenamiento lleno o bloqueado.
import {
  commitmentFor,
  forgetSeatSecret,
  prepareSeat,
  seatSecretFor,
  type SeatStore,
} from "../lib/seat-secret.ts";

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

function throws(name: string, fn: () => unknown) {
  let lanzo = false;
  try {
    fn();
  } catch {
    lanzo = true;
  }
  check(name, lanzo, true);
}

/** Tienda de mentira que además apunta en qué ORDEN se la usó. */
function fakeStore() {
  const data = new Map<string, string>();
  const log: string[] = [];
  const store: SeatStore = {
    getItem: (k) => {
      log.push(`get ${k}`);
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      log.push(`set ${k}`);
      data.set(k, v);
    },
    removeItem: (k) => {
      log.push(`remove ${k}`);
      data.delete(k);
    },
  };
  return { store, log, data };
}

const MESA = "0xabc123";

console.log("\n— El secreto se guarda ANTES de que exista la huella —");

{
  const { store, log } = fakeStore();
  const seat = prepareSeat(MESA, store);
  // La escritura tiene que haber ocurrido dentro de la misma llamada que
  // devuelve la huella: no hay forma de pagar sin haber guardado.
  check(
    "guardar ocurre antes de devolver la huella",
    log.some((l) => l.startsWith("set ")),
    true
  );
  check(
    "el secreto quedó recuperable",
    seatSecretFor(MESA, store),
    seat.secret
  );
}

{
  const { store } = fakeStore();
  const seat = prepareSeat(MESA, store);
  check(
    "la huella es la del secreto guardado",
    commitmentFor(seatSecretFor(MESA, store)!),
    seat.commitment
  );
}

console.log("\n— Si no se puede guardar, NO se puede pagar —");

throws("sin tienda disponible, lanza en vez de devolver huella", () =>
  prepareSeat(MESA, null)
);

{
  // Tienda que acepta el `set` y luego no guarda nada: la cuota llena se porta
  // así. Sin releer, esto habría dejado pagar con una huella sin dueño.
  const rota: SeatStore = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  throws("tienda que finge guardar y no guarda, lanza", () =>
    prepareSeat(MESA, rota)
  );
}

console.log("\n— Reintentar un pago no cambia la huella —");

{
  const { store } = fakeStore();
  const primera = prepareSeat(MESA, store);
  const segunda = prepareSeat(MESA, store);
  check("el secreto se reutiliza", segunda.secret, primera.secret);
  check("y por tanto la huella también", segunda.commitment, primera.commitment);
}

console.log("\n— Cada mesa tiene el suyo —");

{
  const { store } = fakeStore();
  const a = prepareSeat("0xaaa", store);
  const b = prepareSeat("0xbbb", store);
  check("secretos distintos por mesa", a.secret !== b.secret, true);
  check("huellas distintas", a.commitment !== b.commitment, true);
  check(
    "el identificador no distingue mayúsculas",
    seatSecretFor("0xAAA", store),
    a.secret
  );
}

console.log("\n— La huella no revela el secreto —");

{
  const { store } = fakeStore();
  const seat = prepareSeat(MESA, store);
  check(
    "la huella no contiene el secreto",
    seat.commitment.includes(seat.secret.slice(2)),
    false
  );
  check("el secreto son 32 bytes", seat.secret.length, 66);
  check(
    "dos secretos seguidos no se repiten",
    prepareSeat("0xotra", store).secret !== seat.secret,
    true
  );
}

console.log("\n— Olvidar solo cuando ya no hay silla que reclamar —");

{
  const { store } = fakeStore();
  prepareSeat(MESA, store);
  forgetSeatSecret(MESA, store);
  check("olvidado", seatSecretFor(MESA, store), null);
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
